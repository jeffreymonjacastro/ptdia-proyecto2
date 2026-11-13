import { useCallback, useEffect, useRef, useState } from 'react'
import { loadWorkspace, saveWorkspace, type Workspace } from './storage.ts'
import { seedProjects } from './domain.ts'

function freshWorkspace(): Workspace {
  const projects = seedProjects()
  return { schema: 1, projects, activeId: projects[0].id, designer: 'Mariana' }
}

export function useWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace>()
  const [storageError, setStorageError] = useState('')
  const [saving, setSaving] = useState(false)
  const writable = useRef(true)
  const latestSave = useRef(0)
  useEffect(() => {
    let active = true
    loadWorkspace().then(data => { if (active) setWorkspace(data ?? freshWorkspace()) }).catch(cause => {
      if (!active) return
      writable.current = false
      setStorageError(`${cause instanceof Error ? cause.message : 'El navegador no permite guardar el historial.'} Los cambios de esta vista se conservarán solo mientras permanezca abierta.`)
      setWorkspace({ schema: 1, projects: [], activeId: null, designer: 'Mariana' })
    })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (!workspace || !writable.current) return
    const saveId = ++latestSave.current
    setSaving(true)
    void saveWorkspace(workspace).then(() => {
      if (saveId === latestSave.current) { setSaving(false); setStorageError('') }
    }).catch(() => {
      if (saveId === latestSave.current) {
        setSaving(false)
        setStorageError('No se pudo guardar el último cambio. Puede faltar espacio o estar bloqueado el almacenamiento. Conserva esta pestaña abierta y vuelve a intentar.')
      }
    })
  }, [workspace])
  useEffect(() => {
    if (!saving && !storageError) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [saving, storageError])
  const retrySave = useCallback(async () => {
    if (!workspace) return
    try {
      if (!writable.current) {
        const recovered = await loadWorkspace()
        writable.current = true
        setWorkspace(current => {
          if (!current) return current
          const ids = new Set(current.projects.map(p => p.id))
          const projects = [...current.projects, ...(recovered?.projects.filter(p => !ids.has(p.id)) ?? [])]
          return { ...current, projects, activeId: current.activeId ?? recovered?.activeId ?? projects[0]?.id ?? null }
        })
        return
      }
      await saveWorkspace(workspace)
      writable.current = true; setStorageError('')
    } catch { setStorageError('El historial sigue sin poder guardarse. Los datos anteriores se conservan. Mantén esta pestaña abierta para no perder los cambios nuevos.') }
  }, [workspace])
  return { workspace, setWorkspace, saving, storageError, retrySave }
}
