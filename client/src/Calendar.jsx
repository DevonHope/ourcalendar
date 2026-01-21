import React, { useState, useMemo } from 'react'

function formatDate(ts){
  const d = new Date(ts)
  return d.toLocaleString()
}

function dayStart(date){
  const d = new Date(date)
  d.setHours(0,0,0,0)
  return d.getTime()
}

function addDays(ts, n){ const d = new Date(ts); d.setDate(d.getDate()+n); return d.getTime() }

export default function Calendar({ events = [], calendars = [], reload, visibleCalendarIds: visibleCalendarIdsProp }){
  const [view, setView] = useState('month') // month, week, day, agenda
  const [cursor, setCursor] = useState(Date.now())
  const [selectedCal, setSelectedCal] = useState(null)
  const [editing, setEditing] = useState(null)
  const [showCreateCal, setShowCreateCal] = useState(false)
  const [importText, setImportText] = useState('')
  const importFileRef = React.useRef(null)
  const [visibleCalendarIdsLocal, setVisibleCalendarIdsLocal] = useState(new Set())
  // derive effective visible ids: prefer prop (controlled) otherwise local state
  const visibleCalendarIds = (visibleCalendarIdsProp && typeof visibleCalendarIdsProp.has === 'function') ? visibleCalendarIdsProp : visibleCalendarIdsLocal
  // initialize visible calendars to all calendars when they load (preserve user selection if already set)
  React.useEffect(()=>{
    if (visibleCalendarIdsProp && typeof visibleCalendarIdsProp.has === 'function') return
    setVisibleCalendarIdsLocal(prev => {
      if (prev && prev.size > 0) return prev
      if (!calendars || calendars.length === 0) return prev
      return new Set(calendars.map(c=>c.id))
    })
  }, [calendars, visibleCalendarIdsProp])

  function toggleCalendar(id){
    // if parent passed a Set-like prop, try to call their setter via postMessage pattern is not available; fall back to local state
    // if parent controls visible ids, try calling postMessage or let parent settings manage it; fall back to local state
    setVisibleCalendarIdsLocal(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const t = {
    card: 'var(--card)', border: 'var(--border)', lightBorder: 'var(--light-border)', text: 'var(--text)', overlay: 'var(--overlay)', bg: 'var(--bg)'
  }

  const calMap = useMemo(()=>{
    const m = new Map()
    for (const c of calendars) m.set(c.id, c)
    return m
  }, [calendars])
  // minimal rounded style tokens
  const cardStyle = { borderRadius: 12, boxShadow: '0 6px 18px rgba(15,23,42,0.06)', padding: 12, background: 'var(--card)' }
  const inputStyle = { width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid var(--input-border)`, background: 'var(--bg)', color: 'var(--text)' }
  const smallBtn = { padding: '6px 8px', fontSize: 12 }
  const eventsByDay = useMemo(() => {
    const map = {}
    for (const ev of events) {
      const day = dayStart(ev.start)
      if (!map[day]) map[day]=[]
      map[day].push(ev)
    }
    return map
  }, [events])

  const today = dayStart(Date.now())

  function weekNumber(dt){
    const d = new Date(dt)
    // ISO week number (simple approximation)
    const onejan = new Date(d.getFullYear(),0,1)
    const millisecsInDay = 86400000
    return Math.ceil((((d - onejan) / millisecsInDay) + onejan.getDay()+1)/7)
  }

  function formatHeaderToday(view, cursorTs){
    const d = new Date(cursorTs)
    if (view === 'month') return d.toLocaleString(undefined, { month: 'long', year: 'numeric' })
    if (view === 'week') return `Week ${weekNumber(d)} ${d.toLocaleString(undefined, { month:'short', year:'numeric' })}`
    // day
    return d.toDateString()
  }

  // centralized add-event handler: require at least one calendar
  function handleAddEvent(startTs){
    if (!calendars || calendars.length === 0) {
      // prompt user to create a calendar first
      setShowCreateCal(true)
      try { window.alert('Please create a calendar before adding events.') } catch(e){}
      return
    }
    setEditing({ start: startTs || Date.now(), end: null, title: '' })
  }

  const visibleEvents = useMemo(() => {
    // apply calendar filtering first (if any calendars are selected)
    const hasSelection = visibleCalendarIds && visibleCalendarIds.size > 0
    const base = hasSelection ? events.filter(e => e.calendar_id != null && visibleCalendarIds.has(e.calendar_id)) : events
    if (view === 'agenda') {
      return [...base].sort((a,b)=>a.start-b.start).slice(0,10)
    }
    // for other views, return events in the relevant range
    const start = view === 'day' ? dayStart(cursor) : view === 'week' ? dayStart(addDays(cursor,-(new Date(cursor).getDay()))) : dayStart(new Date(cursor).setDate(1))
    // compute end
    let end
    if (view === 'day') end = addDays(start,1)
    else if (view === 'week') end = addDays(start,7)
    else if (view === 'month') {
      const d = new Date(start); d.setMonth(d.getMonth()+1); end = d.getTime()
    }
    return base.filter(e => e.start >= start && e.start < end).sort((a,b)=>a.start-b.start)
  }, [view, cursor, events, visibleCalendarIds])

  function next(){
    const d = new Date(cursor)
    if (view==='day') d.setDate(d.getDate()+1)
    else if (view==='week') d.setDate(d.getDate()+7)
    else d.setMonth(d.getMonth()+1)
    setCursor(d.getTime())
  }
  function prev(){
    const d = new Date(cursor)
    if (view==='day') d.setDate(d.getDate()-1)
    else if (view==='week') d.setDate(d.getDate()-7)
    else d.setMonth(d.getMonth()-1)
    setCursor(d.getTime())
  }

  async function saveEvent(ev){
    if (ev.id) {
      await fetch('/api/events/'+ev.id, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(ev) })
    } else {
      await fetch('/api/events', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(ev) })
    }
    setEditing(null)
    reload && reload()
  }

  async function deleteEvent(id){
    await fetch('/api/events/'+id, { method: 'DELETE' })
    reload && reload()
  }

  async function createCalendar(name){
  // accept either a string or an object { name, color }
  let payload = { name }
  if (typeof name === 'object' && name !== null) payload = { name: name.name, color: name.color }
    try {
      const res = await fetch('/api/calendars', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) })
      const data = await res.json().catch(()=>null)
      if (!res.ok) throw new Error('Create failed')
      reload && reload()
      return data
    } catch (e) {
      console.error('createCalendar error', e)
      return null
    }
  }

  async function shareCalendar(calendarId){
    try {
      const res = await fetch('/api/share', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ calendar_id: calendarId }) })
      const data = await res.json()
      if (!res.ok) { window.alert(data.error || 'Share failed'); return }
      // build a canonical public link using ourcalendar.ca and token returned by server
      const link = data.token ? `https://ourcalendar.ca/share/${data.token}` : (data.link || '')
      try {
        await navigator.clipboard.writeText(link)
        window.alert('Share link copied to clipboard:\n' + link)
      } catch (e) {
        window.prompt('Share link (copy):', link)
      }
    } catch (e) { console.error('share error', e); window.alert('Share failed') }
  }

  async function doImport(){
    // left as a fallback (not used with file UI)
    try {
      const parsed = importText ? JSON.parse(importText) : []
      if (!Array.isArray(parsed)) return window.alert('Paste a JSON array of events')
      const res = await fetch('/api/import', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ events: parsed }) })
      const data = await res.json()
      window.alert('Imported: ' + (data.imported || 0))
      setImportText('')
      reload && reload()
    } catch(e) { window.alert('Import failed') }
  }

  function toIsoFromIcs(v){
    if (!v) return null
    const s = String(v).trim()
    if (/^\d{8}T\d{6}Z$/.test(s)) return s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8)+'T'+s.slice(9,11)+':'+s.slice(11,13)+':'+s.slice(13,15)+'Z'
    if (/^\d{8}T\d{6}$/.test(s)) return s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8)+'T'+s.slice(9,11)+':'+s.slice(11,13)+':'+s.slice(13,15)
    if (/^\d{8}$/.test(s)) return s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8)
    return s
  }

  function parseIcs(text){
    if (!text) return []
    text = text.replace(/\r\n[ \t]/g,'') // unfold folded lines
    const parts = text.split(/BEGIN:VEVENT/i).slice(1)
    const evs = []
    for (const p of parts){
      const block = p.split(/END:VEVENT/i)[0]
      const lines = block.split(/\r?\n/)
      let title = ''
      let desc = ''
      let dtstart = null
      let dtend = null
      for (let line of lines){
        line = line.trim()
        if (!line) continue
        const idx = line.indexOf(':')
        if (idx === -1) continue
        const key = line.slice(0, idx)
        const val = line.slice(idx+1)
        if (/^SUMMARY/i.test(key)) title = val
        else if (/^DESCRIPTION/i.test(key)) desc += (desc ? '\n' : '') + val.replace(/\\n/g,'\n')
        else if (/^DTSTART/i.test(key)) dtstart = val
        else if (/^DTEND/i.test(key)) dtend = val
      }
      if (!title) title = 'Untitled'
      const startIso = toIsoFromIcs(dtstart)
      const endIso = toIsoFromIcs(dtend)
      const startTs = startIso ? (new Date(startIso)).getTime() : Date.now()
      const endTs = endIso ? (new Date(endIso)).getTime() : null
      evs.push({ title, start: startTs, end: endTs, description: desc })
    }
    return evs
  }

  async function doImportIcsFile(file){
    if (!file) return
    try {
      const text = await file.text()
      const eventsToImport = parseIcs(text)
      if (!eventsToImport.length) return window.alert('No events found in file')
      const res = await fetch('/api/import', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ events: eventsToImport }) })
      const data = await res.json()
      if (res.ok) { window.alert('Imported: ' + (data.imported || 0)); reload && reload() } else { window.alert('Import failed: ' + (data.error || 'unknown')) }
    } catch (e) { console.error(e); window.alert('Import failed') }
  }

  return (
    <div className="calendar-root" style={{display:'flex',gap:20,color:'var(--text)', background: 'var(--bg)', padding: 6, position:'relative'}}>
      <div className="calendar-main" style={{flex:'1 1 600px'}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  <div className="view-buttons" style={{display:'flex',gap:8,alignItems:'center'}}>
                    <button className="btn" onClick={() => setView('month')} disabled={view==='month'}>Month</button>
                    <button className="btn" onClick={() => setView('week')} disabled={view==='week'}>Week</button>
                    <button className="btn" onClick={() => setView('day')} disabled={view==='day'}>Day</button>
                    <button className="btn" onClick={() => setView('agenda')} disabled={view==='agenda'}>Agenda</button>
                  </div>
          </div>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <button className="btn small" onClick={prev}>◀</button>
          <button className="btn small" onClick={() => setCursor(Date.now())}>Today</button>
          <button className="btn small" onClick={next}>▶</button>
          </div>
          <div style={{marginLeft:10}} className="toolbar-date"><strong>{new Date(cursor).toDateString()}</strong></div>
          <select className="mobile-view-select" value={view} onChange={(e)=>setView(e.target.value)} aria-hidden>
            <option value="month">Month</option>
            <option value="week">Week</option>
            <option value="day">Day</option>
            <option value="agenda">Agenda</option>
          </select>
          {/* theme toggle moved to top-right */}
        </div>

  <div className={`calendar-card ${view==='month' ? 'month-view' : ''}`} style={{...cardStyle, border:`1px solid ${t.border}`, marginTop:10}}>
          {view==='agenda' ? (
            <div>
              <h3>Agenda (next {Math.min(10, visibleEvents.length)} events)</h3>
              <div style={{maxHeight:300,overflowY:'auto'}}>
                {visibleEvents.map(ev => (
                  <div key={ev.id} style={{padding:8,borderBottom:`1px solid ${t.lightBorder}`, borderRadius:8}}>
                    <div style={{display:'flex',justifyContent:'space-between'}}>
                      <div>
                        <strong>{ev.title}</strong>
                        <div style={{fontSize:12}}>{formatDate(ev.start)}{ev.end? ' — '+formatDate(ev.end):''}</div>
                      </div>
                      <div>
                        <button className="btn small" onClick={() => setEditing(ev)}>Edit</button>
                        <button className="btn small" onClick={() => deleteEvent(ev.id)}>Delete</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <h3 className="view-title">{view.charAt(0).toUpperCase()+view.slice(1)} view</h3>
              <div className="today-bar header-today-bar" aria-hidden>
                <strong>{formatHeaderToday(view, cursor)}</strong>
              </div>
              {view==='month' && (
                <div>
                  {/* simple month grid: show days 1..n with events count */}
                  <MonthGrid cursor={cursor} eventsByDay={eventsByDay} onDayClick={(day)=>{ setCursor(day); setView('day') }} themeVars={t} today={today} calMap={calMap} />
                </div>
              )}

              {view==='week' && (
                <div>
                  <WeekView cursor={cursor} eventsByDay={eventsByDay} onSlotClick={(ts)=>{ handleAddEvent(ts) }} themeVars={t} today={today} calMap={calMap} />
                </div>
              )}

              {view==='day' && (
                <div>
                  <DayView cursor={cursor} events={visibleEvents} onAdd={(ts)=>handleAddEvent(ts)} onEdit={(ev)=>setEditing(ev)} onDelete={(id)=>deleteEvent(id)} themeVars={t} calMap={calMap} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

  <div className="calendar-sidebar" style={{width:320}}>
        <div style={{border:`1px solid ${t.border}`,padding:10,background:t.card}}>
          <h4>Calendars</h4>
          <div>
            {calendars.length ? calendars.map(c => (
              <div key={c.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:6}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <input aria-label={`Show ${c.name}`} type="checkbox" checked={visibleCalendarIds.has(c.id)} onChange={()=>toggleCalendar(c.id)} />
                  <div>{c.name}</div>
                </div>
                 <div>
                   <button className="btn small" onClick={() => shareCalendar(c.id)}>Share</button>
                 </div>
               </div>
             )) : <div>No calendars yet.</div>}
            <div style={{marginTop:8}}>
              {!showCreateCal && (
                <button className="btn" onClick={()=>setShowCreateCal(true)}>+ New calendar</button>
              )}
              {showCreateCal && (
                <CreateCalendarModal onCreate={createCalendar} onCancel={()=>setShowCreateCal(false)} inputStyle={inputStyle} />
              )}
            </div>
          </div>
        </div>

        <div style={{border:`1px solid ${t.border}`,padding:10,marginTop:10,background:t.card}}>
          <h4>Import .ics / iCal file</h4>
          <input ref={importFileRef} type="file" accept=".ics,text/calendar,application/ics" style={{display:'none'}} onChange={(e)=>doImportIcsFile(e.target.files && e.target.files[0])} />
          <div style={{display:'flex',gap:8,marginTop:8}}>
            <button className="btn" onClick={()=>importFileRef.current && importFileRef.current.click()}>Import .ics</button>
          </div>
        </div>
      </div>

      {editing && (
        <EditModal ev={editing} onClose={()=>setEditing(null)} onSave={saveEvent} calendars={calendars} themeVars={t} inputStyle={inputStyle} />
      )}
    </div>
  )
}

function MonthGrid({ className, cursor, eventsByDay, onDayClick, themeVars, today, calMap }){
  const d = new Date(cursor)
  d.setDate(1)
  const startDay = d.getDay()
  const days = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate()
  const cells = []
  for (let i=0;i<startDay;i++) cells.push(null)
  for (let i=1;i<=days;i++) cells.push(new Date(d.getFullYear(), d.getMonth(), i).getTime())
  const t = themeVars || { border:'var(--border)', lightBorder:'var(--light-border)', card:'var(--card)', bg:'var(--bg)', text:'var(--text)' }
  return (
    <div className={className || ''} style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:4}}>
      {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(h => <div key={h} style={{fontWeight:600}}>{h}</div>)}
      {cells.map((ts,idx)=> {
        const isToday = ts === today
        return (
          <div key={idx} style={{border:`${isToday ? '3px' : '1px'} solid ${isToday ? 'var(--primary)' : t.lightBorder}`,minHeight:120,padding:6,background:t.card,color:t.text}} onClick={()=>ts && onDayClick(ts)}>
            {ts ? (
              <div>
                  <div style={{fontSize:12,fontWeight:600}}>{new Date(ts).getDate()}</div>
                        {(eventsByDay[ts]||[]).map(ev => {
                          const cal = calMap && calMap.get(ev.calendar_id)
                          const color = ev.color || (cal && cal.color) || 'var(--accent)'
                          return (
                            <div key={ev.id} style={{fontSize:10, padding:4, borderRadius:6, background: color, color:'#fff', marginBottom:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{new Date(ev.start).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})} {ev.title}</div>
                          )
                        })}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function WeekView({ className, cursor, eventsByDay, onSlotClick, themeVars, today, calMap }){
  const start = dayStart(addDays(cursor, -new Date(cursor).getDay()))
  const days = Array.from({length:7}).map((_,i)=>addDays(start,i))
  const t = themeVars || { border:'var(--border)', lightBorder:'var(--light-border)', card:'var(--card)', text:'var(--text)' }
  const times = Array.from({length:24}).map((_,h)=>h)

  // helper to get hour fraction from timestamp
  const getHourFraction = (ts) => {
    const d = new Date(ts)
    return d.getHours() + d.getMinutes() / 60
  }

  // helper to get duration in hours
  const getDurationHours = (ev) => {
    if (!ev.end) return 1 // default 1 hour
    return (ev.end - ev.start) / (1000 * 60 * 60)
  }

  return (
    <div className={`week-container ${className||''}`} style={{display:'flex',gap:8}}>
      <div className="time-gutter" aria-hidden>
        {times.map(h => (
          <div key={h} className="time-slot">{new Date(1970,0,1,h).toLocaleTimeString([], {hour:'numeric'})}</div>
        ))}
      </div>
      <div className="week-grid" style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:4,flex:1}}>
        {days.map(d => {
          const isToday = d === today
          const dayEvents = (eventsByDay[d]||[]).sort((a,b)=>a.start - b.start)
          // group overlapping events
          const positionedEvents = []
          for (const ev of dayEvents) {
            const startHour = getHourFraction(ev.start)
            const duration = getDurationHours(ev)
            const top = startHour * 40
            const height = Math.max(duration * 40, 32) // min height
            let left = 0
            let width = 100
            // simple overlap detection: if overlaps with previous, shift left
            for (const prev of positionedEvents) {
              if (startHour < prev.startHour + prev.duration && startHour + duration > prev.startHour) {
                // overlap, adjust
                if (prev.left === 0) {
                  left = 50
                  width = 50
                  prev.left = 0
                  prev.width = 50
                } else {
                  left = 0
                  width = 50
                }
                break
              }
            }
            positionedEvents.push({ ...ev, top, height, left, width, startHour, duration })
          }
          return (
            <div key={d} className={`week-day ${isToday? 'today':''}`} onDoubleClick={()=>onSlotClick(d)}>
              <div className="week-day-header">{new Date(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
              <div className="week-day-body">
                {positionedEvents.map(ev => {
                  const cal = calMap && calMap.get(ev.calendar_id)
                  const accent = ev.color || (cal && cal.color) || 'var(--accent)'
                  return (
                    <div key={ev.id} className="event-pill" style={{
                      top: `${ev.top}px`,
                      height: `${ev.height}px`,
                      left: `${ev.left}%`,
                      width: `${ev.width}%`,
                      background: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))',
                      border: `1px solid rgba(255,255,255,0.05)`,
                      borderLeft: `3px solid ${accent}`
                    }}>
                      <div className="event-accent" style={{background: accent}}/>
                      <div className="event-body">
                        <div className="event-time">{new Date(ev.start).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}</div>
                        <div className="event-title">{ev.title}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DayView({ cursor, events, onAdd, onEdit, onDelete, themeVars }){
  const d = new Date(cursor)
  const t = themeVars || { border:'var(--border)', lightBorder:'var(--light-border)', card:'var(--card)', bg:'var(--bg)', text:'var(--text)' }
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
        <div className="dayview-title" style={{fontSize:16,fontWeight:700}}>{new Date(d.getFullYear(), d.getMonth(), d.getDate()).toLocaleDateString()}</div>
        <div style={{display:'flex',gap:8}}>
          <button className="btn primary" onClick={()=>onAdd(Date.now())}>+ Add event</button>
        </div>
      </div>
      <div>
        {events.length ? events.map(ev => (
          <div key={ev.id} style={{padding:8,borderBottom:`1px solid ${t.lightBorder}`,color:t.text}}>
            <div style={{display:'flex',justifyContent:'space-between'}}>
              <div>
                <strong>{ev.title}</strong>
                <div style={{fontSize:12}}>{formatDate(ev.start)}{ev.end? ' — '+formatDate(ev.end):''}</div>
              </div>
              <div style={{display:'flex',gap:6}}>
                <button className="btn" onClick={()=>onEdit(ev)}>Edit</button>
                <button className="btn" onClick={()=>onDelete(ev.id)}>Delete</button>
              </div>
            </div>
          </div>
        )) : <div style={{color:t.text}}>No events for this day.</div>}
      </div>
    </div>
  )
}

function CreateCalendarModal({ onCreate, onCancel, inputStyle }){
  const [name, setName] = useState('')
  const [color, setColor] = useState('#4f46e5')
  const [busy, setBusy] = useState(false)
  const handleCreate = async () => {
    if (!name.trim()) return window.alert('Please enter a calendar name')
    setBusy(true)
    try {
      const res = await onCreate({ name, color })
      if (res) onCancel()
      else window.alert('Create failed')
    } catch (e) {
      window.alert('Create failed')
    } finally { setBusy(false) }
  }
  return (
    <div className="modal-overlay">
      <div className="modal-dialog">
        <h3>Create calendar</h3>
        <div style={{display:'grid',gap:8}}>
          <input style={inputStyle} placeholder="Calendar name" value={name} onChange={(e)=>setName(e.target.value)} />
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <div style={{fontSize:13}}>Color</div>
            <input type="color" value={color} onChange={(e)=>setColor(e.target.value)} />
            <div style={{width:22,height:22,background:color,borderRadius:6,border:'1px solid rgba(0,0,0,0.06)'}} />
          </div>
          <div style={{display:'flex',gap:8,marginTop:8}}>
            <button className="btn" onClick={onCancel}>Cancel</button>
            <button className="btn primary" onClick={handleCreate} disabled={busy}>{busy ? 'Creating...' : 'Create'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function EditModal({ ev, onClose, onSave, calendars, themeVars, inputStyle }){
  const calDefaults = calendars && calendars.find(c => c.id === (ev.calendar_id || null)) || {}
  const [draft, setDraft] = useState(()=>({
    id: ev.id, title: ev.title||'', start: ev.start||Date.now(), end: ev.end||null, calendar_id: ev.calendar_id||null, description: ev.description||'',
    reminder: typeof ev.reminder !== 'undefined' ? ev.reminder : (calDefaults.default_reminder || 0),
    repeat: ev.repeat || calDefaults.default_repeat || 'none',
    timezone: ev.timezone || calDefaults.default_timezone || 'UTC'
  }))
  const t = themeVars || { overlay:'var(--overlay)', card:'var(--card)', text:'var(--text)', lightBorder:'var(--light-border)' }
  return (
    <div className="modal-overlay">
      <div className="modal-dialog">
         <h3>{draft.id ? 'Edit event' : 'New event'}</h3>
         <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
           <input style={inputStyle} value={draft.title} onChange={(e)=>setDraft({...draft,title:e.target.value})} placeholder="Title" />
           <select style={inputStyle} value={draft.calendar_id||''} onChange={(e)=>{
             const newCalId = e.target.value ? parseInt(e.target.value,10) : null
             const cal = calendars && calendars.find(c => c.id === newCalId)
             setDraft(prev => ({...prev, calendar_id: newCalId, reminder: prev.reminder || (cal && cal.default_reminder) || 0, repeat: prev.repeat || (cal && cal.default_repeat) || 'none', timezone: prev.timezone || (cal && cal.default_timezone) || 'UTC'}))
           }}>
             <option value="">(default)</option>
             {calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
           </select>
           <input style={inputStyle} type="datetime-local" value={new Date(draft.start).toISOString().slice(0,16)} onChange={(e)=>setDraft({...draft,start: new Date(e.target.value).getTime()})} />
           <input style={inputStyle} type="datetime-local" value={draft.end? new Date(draft.end).toISOString().slice(0,16): ''} onChange={(e)=>setDraft({...draft,end: e.target.value? new Date(e.target.value).getTime(): null})} />
         </div>
         <div style={{marginTop:8}}>
           <textarea placeholder="Description" value={draft.description} onChange={(e)=>setDraft({...draft,description:e.target.value})} style={{width:'100%', padding:10, borderRadius:8, border:`1px solid ${t.lightBorder}`, background: 'var(--card)', color:t.text}} />
         </div>
         <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginTop:8}}>
           <div>
             <label style={{fontSize:13}}>Reminder (minutes)</label>
             <input type="number" min="0" style={inputStyle} value={draft.reminder||0} onChange={(e)=>setDraft({...draft,reminder: e.target.value? parseInt(e.target.value,10): 0})} />
           </div>
           <div>
             <label style={{fontSize:13}}>Repeat</label>
             <select style={inputStyle} value={draft.repeat||'none'} onChange={(e)=>setDraft({...draft,repeat:e.target.value})}>
               <option value="none">None</option>
               <option value="daily">Daily</option>
               <option value="weekly">Weekly</option>
               <option value="monthly">Monthly</option>
               <option value="yearly">Yearly</option>
             </select>
           </div>
           <div>
             <label style={{fontSize:13}}>Timezone</label>
             <input style={inputStyle} value={draft.timezone||'UTC'} onChange={(e)=>setDraft({...draft,timezone:e.target.value})} />
           </div>
         </div>
         <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:10}}>
           <button className="btn" onClick={onClose}>Cancel</button>
           <button className="btn primary" onClick={()=>onSave(draft)} style={{marginLeft:'auto'}}>Save</button>
         </div>
      </div>
    </div>
   )
 }

