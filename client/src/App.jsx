import React, { useEffect, useState, useCallback } from 'react'
import Calendar from './Calendar'

function Login({ onLogin }){
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ username, password })
      })
      const data = await res.json()
      if (res.ok) {
        onLogin(data.user)
      } else {
        setError(data.error || 'Login failed')
      }
    } catch (err) {
      setError('Network error')
    }
  }

  return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:'var(--bg)',color:'var(--text)'}}>
      <form onSubmit={handleSubmit} style={{padding:25,border:'1px solid var(--border)',borderRadius:8,background:'var(--card)'}}>
        <h2>Login</h2>
        {error && <div style={{color:'red',marginBottom:10}}>{error}</div>}
        <div style={{marginBottom:10}}>
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e)=>setUsername(e.target.value)}
            style={{width:'100%',padding:8,border:'1px solid var(--input-border)',borderRadius:4,background:'var(--bg)',color:'var(--text)'}}
          />
        </div>
        <div style={{marginBottom:10}}>
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e)=>setPassword(e.target.value)}
            style={{width:'100%',padding:8,border:'1px solid var(--input-border)',borderRadius:4,background:'var(--bg)',color:'var(--text)'}}
          />
        </div>
        <button type="submit" className="btn primary block">Login</button>
      </form>
    </div>
  )
}

export default function App(){
  const [events, setEvents] = useState([])
  const [calendars, setCalendars] = useState([])
  const [visibleCalendarIds, setVisibleCalendarIds] = useState(new Set())
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem('ourcalendar:user')
      return saved ? JSON.parse(saved) : null
    } catch (e) {
      return null
    }
  })
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('ourcalendar:theme')
      if (saved === 'light' || saved === 'dark') return saved
    } catch (e) {}
    try {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark'
    } catch (e) {}
    return 'light'
  })

  const [showSettings, setShowSettings] = useState(false)

  // helper to update user profile on server
  const handleUpdateUser = async (updates) => {
    try {
      const res = await fetch('/api/user', {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ id: user.id, ...updates })
      })
      const data = await res.json()
      if (res.ok) {
        setUser(data.user)
        localStorage.setItem('ourcalendar:user', JSON.stringify(data.user))
        return { ok: true, user: data.user }
      }
      return { ok: false, error: data.error }
    } catch (e) {
      return { ok: false, error: 'Network error' }
    }
  }

  // Settings pane component
  function SettingsPane({ show, onClose, user, onSave, theme, setTheme, calendars = [], reload, visibleCalendarIds, setVisibleCalendarIds }){
    const [name, setName] = useState(user.name || '')
    const [photo, setPhoto] = useState(user.photo || '')
    const [birthday, setBirthday] = useState(user.birthday || '')
    const [editingCal, setEditingCal] = useState(null)
    const [newPassword, setNewPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [busy, setBusy] = useState(false)
    const [msg, setMsg] = useState('')

    // keep local state in sync if user prop changes externally
    useEffect(()=>{
      setName(user.name || '')
      setPhoto(user.photo || '')
      setBirthday(user.birthday || '')
    }, [user])

    const inputStyle = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--input-border)', background: 'var(--bg)', color: 'var(--text)' }

    const handleSave = async () => {
      setMsg('')
      if (newPassword && newPassword !== confirmPassword) { setMsg('Passwords do not match'); return }
      setBusy(true)
      const updates = { name, photo, birthday }
      if (newPassword) updates.password = newPassword
      const resp = await onSave(updates)
      setBusy(false)
      if (resp.ok) {
        setMsg('Saved')
        setTimeout(()=>{ setMsg(''); onClose() }, 700)
      } else {
        setMsg(resp.error || 'Save failed')
      }
    }

    const doExport = async (what) => {
      try {
        const url = what === 'events' ? '/api/events' : '/api/calendars'
        const res = await fetch(url)
        const data = await res.json()
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const link = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = link
        a.download = what + '.json'
        a.click()
        URL.revokeObjectURL(link)
      } catch(e) { window.alert('Export failed') }
    }

    const handleImportFile = async (file) => {
      if (!file) return
      try {
        const text = await file.text()
        // support JSON event exports and simple .ics files
        if (file.name && file.name.toLowerCase().endsWith('.ics')) {
          // minimal ICS parser (same behavior as Calendar.parseIcs)
          const parseIcs = (text)=>{
            if (!text) return []
            text = text.replace(/\r\n[ \t]/g,'')
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
                else if (/^DESCRIPTION/i.test(key)) desc += (desc ? '\n' : '') + val.replace(/\\n/g,'\\n')
                else if (/^DTSTART/i.test(key)) dtstart = val
                else if (/^DTEND/i.test(key)) dtend = val
              }
              if (!title) title = 'Untitled'
              const toIso = (v)=>{
                if (!v) return null
                const s = String(v).trim()
                if (/^\d{8}T\d{6}Z$/.test(s)) return s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8)+'T'+s.slice(9,11)+':'+s.slice(11,13)+':'+s.slice(13,15)+'Z'
                if (/^\d{8}T\d{6}$/.test(s)) return s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8)+'T'+s.slice(9,11)+':'+s.slice(11,13)+':'+s.slice(13,15)
                if (/^\d{8}$/.test(s)) return s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8)
                return s
              }
              const startIso = toIso(dtstart)
              const endIso = toIso(dtend)
              const startTs = startIso ? (new Date(startIso)).getTime() : Date.now()
              const endTs = endIso ? (new Date(endIso)).getTime() : null
              evs.push({ title, start: startTs, end: endTs, description: desc })
            }
            return evs
          }
          const eventsToImport = parseIcs(text)
          const res = await fetch('/api/import', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ events: eventsToImport }) })
          const data = await res.json()
          if (res.ok) { window.alert('Imported: ' + (data.imported || 0)); onClose(); } else { window.alert('Import failed: ' + (data.error || 'unknown')) }
          return
        }
        const parsed = JSON.parse(text)
        // send to import endpoint; server expects { events: [...] }
        const res = await fetch('/api/import', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ events: parsed }) })
        const data = await res.json()
        if (res.ok) { window.alert('Imported: ' + (data.imported || 0)) ; onClose(); } else { window.alert('Import failed: ' + (data.error || 'unknown')) }
      } catch(e) { window.alert('Invalid file or import failed') }
    }

    return (
      <>
        <div className={`settings-overlay ${show ? 'show' : ''}`} onClick={onClose} />
        <div className={`settings-pane ${show ? 'show' : ''}`} role="dialog" aria-labelledby="settings-title" onClick={(e)=>e.stopPropagation()}>
          <div className="heading">
            <h2 id="settings-title">Settings</h2>
            <div style={{display:'flex',gap:8}}>
              <button onClick={onClose} className="btn">Close</button>
            </div>
          </div>

          <div className="settings-section">
            <h3>Account</h3>
            <div style={{display:'flex',gap:12,alignItems:'center',marginBottom:8}}>
              <img className="settings-avatar" src={photo || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56"><rect width="56" height="56" fill="%23ddd"/></svg>'} alt="avatar" />
              <div style={{flex:1}}>
                <div className="settings-field">
                  <label style={{fontSize:13}}>Name</label>
                  <input style={inputStyle} value={name} onChange={(e)=>setName(e.target.value)} />
                </div>
                <div className="settings-field">
                  <label style={{fontSize:13}}>Photo URL</label>
                  <input style={inputStyle} value={photo} onChange={(e)=>setPhoto(e.target.value)} />
                </div>
                <div className="settings-field">
                  <label style={{fontSize:13}}>Birthday</label>
                  <input style={inputStyle} type="date" value={birthday || ''} onChange={(e)=>setBirthday(e.target.value)} />
                </div>
              </div>
            </div>
            <div className="settings-field">
              <label style={{fontSize:13}}>Change Password</label>
              <input style={inputStyle} type="password" value={newPassword} onChange={(e)=>setNewPassword(e.target.value)} placeholder="New password" />
              <input style={inputStyle} type="password" value={confirmPassword} onChange={(e)=>setConfirmPassword(e.target.value)} placeholder="Confirm password" />
            </div>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <button onClick={handleSave} disabled={busy} className="btn primary">{busy ? 'Saving...' : 'Save'}</button>
              <button onClick={onClose} className="btn">Cancel</button>
              {msg && <div style={{marginLeft:8,fontSize:13}}>{msg}</div>}
            </div>
          </div>

          <div className="settings-divider" aria-hidden="true" />

          <div className="settings-section">
            <h3>Calendar</h3>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <div style={{fontSize:13}}>Theme</div>
              <div style={{marginLeft:8}}>
                <label style={{display:'inline-flex',alignItems:'center',gap:8}}>
                  <input type="checkbox" checked={theme==='dark'} onChange={(e)=>setTheme(e.target.checked ? 'dark' : 'light')} />
                  <span style={{fontSize:13}}>{theme==='dark' ? 'Dark' : 'Light'}</span>
                </label>
              </div>
            </div>
            <div style={{display:'flex',gap:8,marginTop:12,flexWrap:'wrap'}}>
              <button onClick={()=>doExport('events')} className="btn">Export Events</button>
              <button onClick={()=>doExport('calendars')} className="btn">Export Calendars</button>
              <label style={{display:'inline-flex',alignItems:'center',gap:8}}>
                <input type="file" accept="application/json,.ics,text/calendar" style={{display:'none'}} onChange={(e)=>handleImportFile(e.target.files && e.target.files[0])} />
                <button className="btn">Import Events (.json or .ics)</button>
              </label>
            </div>

              <div style={{marginTop:16}}>
              <h4 style={{margin:'8px 0'}}>Manage calendars</h4>
              <div style={{marginTop:8}}>
                <h5 style={{margin:'6px 0'}}>Visible calendars</h5>
                <div style={{display:'flex',flexDirection:'column',gap:6}}>
                  {calendars && calendars.length ? calendars.map(c => (
                    <label key={'sel-'+c.id} style={{display:'flex',alignItems:'center',gap:8}}>
                      <input type="checkbox" checked={visibleCalendarIds && visibleCalendarIds.has && visibleCalendarIds.has(c.id)} onChange={()=>{
                        // toggle via the passed setter
                        if (!setVisibleCalendarIds) return
                        setVisibleCalendarIds(prev => {
                          const next = new Set(prev)
                          if (next.has(c.id)) next.delete(c.id)
                          else next.add(c.id)
                          return next
                        })
                      }} />
                      <span>{c.name}</span>
                    </label>
                  )) : <div>No calendars</div>}
                </div>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                {calendars && calendars.length ? calendars.map(c => (
                  <div key={c.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <div style={{width:14,height:14,background:c.color||'#999',borderRadius:4,border:'1px solid var(--light-border)'}} />
                      <div>{c.name}</div>
                    </div>
                    <div style={{display:'flex',gap:8}}>
                      <button className="btn small" onClick={()=>setEditingCal({...c})}>Edit</button>
                      <button className="btn small ghost" onClick={async ()=>{
                        if (!confirm('Delete this calendar? Events will be unassigned. Continue?')) return
                        try {
                          const resp = await fetch('/api/calendars/'+c.id, { method: 'DELETE' })
                          if (!resp.ok) throw new Error('Delete failed')
                          reload && reload()
                          if (editingCal && editingCal.id === c.id) setEditingCal(null)
                        } catch (e) { window.alert('Delete failed') }
                      }}>Delete</button>
                    </div>
                  </div>
                )) : <div>No calendars yet.</div>}
                <div style={{marginTop:6}}>
                  <button className="btn" onClick={()=>setEditingCal({ name:'', color:'#0f62fe', default_reminder:15, default_repeat:'none', default_timezone:'UTC', isNew:true })}>+ New calendar</button>
                </div>
              </div>
              {editingCal && (
                <div style={{marginTop:12, padding:10, border:'1px solid var(--border)', borderRadius:8, background:'var(--card)'}}>
                  <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                    <input style={{...inputStyle,flex:1,minWidth:120}} value={editingCal.name} onChange={(e)=>setEditingCal({...editingCal,name:e.target.value})} />
                    <input type="color" value={editingCal.color||'#0f62fe'} onChange={(e)=>setEditingCal({...editingCal,color:e.target.value})} />
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:8,marginTop:8}}>
                    <div>
                      <label style={{display:'block',fontSize:13}}>Default reminder (minutes)</label>
                      <input type="number" min="0" style={inputStyle} value={editingCal.default_reminder || 0} onChange={(e)=>setEditingCal({...editingCal,default_reminder: e.target.value? parseInt(e.target.value,10): 0})} />
                    </div>
                    <div>
                      <label style={{display:'block',fontSize:13}}>Repeat</label>
                      <select style={inputStyle} value={editingCal.default_repeat||'none'} onChange={(e)=>setEditingCal({...editingCal,default_repeat:e.target.value})}>
                        <option value="none">None</option>
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                        <option value="yearly">Yearly</option>
                      </select>
                    </div>
                    <div>
                      <label style={{display:'block',fontSize:13}}>Timezone</label>
                      <input style={inputStyle} value={editingCal.default_timezone||'UTC'} onChange={(e)=>setEditingCal({...editingCal,default_timezone:e.target.value})} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>
      </>
    )
  }

  // initialize data-theme attribute and persist changes
  React.useEffect(()=>{
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('ourcalendar:theme', theme) } catch (e) {}
  },[theme])

  const load = useCallback(() => {
    console.debug('App.load: fetching events and calendars')
    fetch('/api/events')
      .then(r => r.json())
      .then(data => { console.debug('App.load: events', data.length); setEvents(data) })
      .catch((e) => { console.error('App.load events error', e); setEvents([]) })
    fetch('/api/calendars')
      .then(r => r.json())
      .then(data => { console.debug('App.load: calendars', data.length); setCalendars(data) })
      .catch((e) => { console.error('App.load calendars error', e); setCalendars([]) })
  }, [])

  useEffect(() => { load() }, [load])

  const handleLogin = (userData) => {
    setUser(userData)
    localStorage.setItem('ourcalendar:user', JSON.stringify(userData))
  }

  const handleLogout = () => {
    setUser(null)
    localStorage.removeItem('ourcalendar:user')
  }

  if (!user) {
    return <Login onLogin={handleLogin} />
  }

  return (
    <div style={{fontFamily: 'Inter, system-ui, Arial', padding: 20}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <h1 style={{margin:0}}>OurCalendar</h1>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <button onClick={()=>setShowSettings(true)} className="settings-button" title="Settings">{user.username.charAt(0).toUpperCase()}</button>
        </div>
      </div>

  <SettingsPane show={showSettings} onClose={()=>setShowSettings(false)} user={user} onSave={handleUpdateUser} theme={theme} setTheme={setTheme} calendars={calendars} reload={load} visibleCalendarIds={visibleCalendarIds} setVisibleCalendarIds={setVisibleCalendarIds} />

  <Calendar events={events} calendars={calendars} reload={load} visibleCalendarIds={visibleCalendarIds} />
    </div>
  )
}
