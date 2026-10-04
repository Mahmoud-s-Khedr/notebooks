import React, { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import { Copy, FileText, GripVertical, Link2, MoreHorizontal, Plus, Trash2, Type, Volume2, X } from 'lucide-react'
import {
  textBlockTypes,
  type Block,
  type BlockRelation,
  type PageWorkspace as Workspace,
  type TextBlockType
} from '../../../../shared/domain'
import { Button, DropdownMenu, Popover } from '../../components/ui'

const label = (type: string): string => type.replaceAll('_', ' ')
const transcriptionLanguages = [
  ['ar', 'Arabic'],
  ['bn', 'Bengali'],
  ['zh', 'Chinese'],
  ['nl', 'Dutch'],
  ['en', 'English'],
  ['fr', 'French'],
  ['de', 'German'],
  ['el', 'Greek'],
  ['hi', 'Hindi'],
  ['id', 'Indonesian'],
  ['it', 'Italian'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['ms', 'Malay'],
  ['fa', 'Persian'],
  ['pl', 'Polish'],
  ['pt', 'Portuguese'],
  ['ru', 'Russian'],
  ['es', 'Spanish'],
  ['sw', 'Swahili'],
  ['ta', 'Tamil'],
  ['th', 'Thai'],
  ['tr', 'Turkish'],
  ['uk', 'Ukrainian'],
  ['ur', 'Urdu'],
  ['vi', 'Vietnamese']
] as const
type Props = {
  workspace: Workspace
  notebookId: string | null
  mode: 'write' | 'research'
  reloadWorkspace: () => Promise<void>
  loadMore: () => Promise<void>
  activeNoteId: string | null
  setActiveNoteId: (id: string | null) => void
  onError: (error: unknown) => void
  onChanged: () => Promise<void>
  onTrashed: () => Promise<void>
  onViewSource: () => void
  onUtilities: (kind: 'export' | 'trash') => void
}

export function PageWorkspace({
  workspace,
  notebookId,
  mode,
  reloadWorkspace,
  loadMore,
  activeNoteId,
  setActiveNoteId,
  onError,
  onChanged,
  onTrashed,
  onViewSource,
  onUtilities
}: Props): ReactElement {
  const [title, setTitle] = useState(workspace.title)
  useEffect(() => setTitle(workspace.title), [workspace.id, workspace.title])
  const createNote = async () => {
    try {
      const note = await window.researchNotebook.notes.create({ pageId: workspace.id, title: 'Untitled note' })
      setActiveNoteId(note.id)
      await reloadWorkspace()
    } catch (error) {
      onError(error)
    }
  }
  const saveTitle = async () => {
    if (title.trim() && title !== workspace.title)
      try {
        await window.researchNotebook.pages.update({ pageId: workspace.id, title })
        await Promise.all([reloadWorkspace(), onChanged()])
      } catch (error) {
        onError(error)
      }
  }
  const movePageToTrash = async () => {
    try {
      await window.researchNotebook.trash.move({ entityType: 'page', id: workspace.id })
      await onTrashed()
    } catch (error) {
      onError(error)
    }
  }
  const blocks = workspace.notes.flatMap((note) => note.blocks)
  return (
    <div className={`page-workspace ${mode}`}>
      <header className="page-header" data-item-id={workspace.id}>
        <div>
          <p className="breadcrumb">
            Notebook <span>/</span> Topic page
          </p>
          <input
            className="page-title"
            aria-label="Page title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => void saveTitle()}
          />
        </div>
        <Button variant="secondary" onClick={() => void createNote()}>
          <Plus size={16} /> Add note
        </Button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button variant="icon" aria-label="Page actions">
              <MoreHorizontal size={18} />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="menu-content" align="end">
              <DropdownMenu.Item className="menu-item" onSelect={() => onUtilities('export')}>
                <FileText size={15} /> Export page
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="menu-separator" />
              <DropdownMenu.Item className="menu-item destructive" onSelect={() => void movePageToTrash()}>
                <Trash2 size={15} /> Move page to trash
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </header>
      <div className="notes">
        {workspace.notes.map((note) => (
          <NoteEditor
            key={note.id}
            note={note}
            notebookId={notebookId}
            allBlocks={blocks}
            active={activeNoteId === note.id}
            setActive={() => setActiveNoteId(note.id)}
            reloadWorkspace={reloadWorkspace}
            onError={onError}
            onTrashed={onTrashed}
            onViewSource={onViewSource}
          />
        ))}
      </div>
      {workspace.nextCursor && (
        <Button className="load-more" variant="secondary" onClick={() => void loadMore()}>
          Load more notes
        </Button>
      )}
      {!workspace.notes.length && (
        <div className="empty-state">
          <p>This topic has no notes yet.</p>
          <Button onClick={() => void createNote()}>Create first note</Button>
        </div>
      )}
    </div>
  )
}

function NoteEditor({
  note,
  notebookId,
  allBlocks,
  active,
  setActive,
  reloadWorkspace,
  onError,
  onTrashed,
  onViewSource
}: {
  note: Workspace['notes'][number]
  notebookId: string | null
  allBlocks: Block[]
  active: boolean
  setActive: () => void
  reloadWorkspace: () => Promise<void>
  onError: (error: unknown) => void
  onTrashed: () => Promise<void>
  onViewSource: () => void
}): ReactElement {
  const [slashOpen, setSlashOpen] = useState(false)
  const createBlock = async (type: TextBlockType = 'text') => {
    try {
      await window.researchNotebook.blocks.create({ noteId: note.id, type, data: { text: '' } })
      await reloadWorkspace()
    } catch (error) {
      onError(error)
    }
  }
  const moveBlock = async (block: Block, direction: -1 | 1) => {
    const from = note.blocks.findIndex(({ id }) => id === block.id)
    const to = from + direction
    if (to < 0 || to >= note.blocks.length) return
    const ids = note.blocks.map(({ id }) => id)
    ;[ids[from], ids[to]] = [ids[to], ids[from]]
    try {
      await window.researchNotebook.blocks.reorder({ noteId: note.id, blockIds: ids })
      await reloadWorkspace()
    } catch (error) {
      onError(error)
    }
  }
  return (
    <article
      className={`note-document ${active ? 'focused-note' : ''}`}
      data-item-id={note.id}
      onFocusCapture={setActive}
    >
      {note.blocks.map((block, index) => (
        <BlockEditor
          key={block.id}
          block={block}
          availableBlocks={allBlocks}
          canMoveUp={index > 0}
          canMoveDown={index < note.blocks.length - 1}
          onMove={(direction) => void moveBlock(block, direction)}
          onSaved={reloadWorkspace}
          onError={onError}
          onTrashed={onTrashed}
          onViewSource={onViewSource}
        />
      ))}
      <div className="block-add">
        <Button variant="ghost" onClick={() => void createBlock()}>
          <Plus size={16} /> Add block
        </Button>
        <AudioRecorder noteId={note.id} onSaved={reloadWorkspace} onError={onError} />
        <Popover.Root open={slashOpen} onOpenChange={setSlashOpen}>
          <Popover.Trigger asChild>
            <Button variant="ghost" className="slash-hint" aria-label="Open block command menu">
              <Type size={15} /> Type <kbd>/</kbd> for commands
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content className="slash-menu" side="top" align="start">
              <strong>Insert a block</strong>
              {textBlockTypes
                .filter((type) => type !== 'text')
                .map((type) => (
                  <button
                    key={type}
                    onClick={() => {
                      void createBlock(type)
                      setSlashOpen(false)
                    }}
                  >
                    <span>/{label(type)}</span>
                    <small>{label(type)} block</small>
                  </button>
                ))}
              <button
                onClick={() => {
                  void importAsset('image')
                  setSlashOpen(false)
                }}
              >
                <span>/image</span>
                <small>Attach an image</small>
              </button>
              <button
                onClick={() => {
                  setSlashOpen(false)
                  void record()
                }}
              >
                <span>/audio</span>
                <small>Use Record audio</small>
              </button>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </article>
  )
  async function importAsset(kind: 'image'): Promise<void> {
    if (!notebookId) return
    try {
      const asset = await window.researchNotebook.assets.import({ notebookId, kind })
      if (asset) await window.researchNotebook.assets.attach({ noteId: note.id, assetId: asset.id, type: kind })
      await reloadWorkspace()
    } catch (error) {
      onError(error)
    }
  }
  async function record(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((track) => track.stop())
      onError(new Error('Use the audio button in a block to start a recording.'))
    } catch (error) {
      onError(error)
    }
  }
}

function BlockEditor({
  block,
  availableBlocks,
  canMoveUp,
  canMoveDown,
  onMove,
  onSaved,
  onError,
  onTrashed,
  onViewSource
}: {
  block: Block
  availableBlocks: Block[]
  canMoveUp: boolean
  canMoveDown: boolean
  onMove: (direction: -1 | 1) => void
  onSaved: () => Promise<void>
  onError: (error: unknown) => void
  onTrashed: () => Promise<void>
  onViewSource: () => void
}): ReactElement {
  const [text, setText] = useState(typeof block.data.text === 'string' ? block.data.text : '')
  const [inspector, setInspector] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const textBased = textBlockTypes.includes(block.type as TextBlockType)
  useEffect(() => setText(typeof block.data.text === 'string' ? block.data.text : ''), [block.id, block.data.text])
  const save = async () => {
    if (text !== block.data.text)
      try {
        await window.researchNotebook.blocks.update({ blockId: block.id, data: { ...block.data, text } })
        await onSaved()
      } catch (error) {
        onError(error)
      }
  }
  const duplicate = async () => {
    try {
      await window.researchNotebook.blocks.duplicate({ blockId: block.id })
      await onSaved()
    } catch (error) {
      onError(error)
    }
  }
  const trash = async () => {
    try {
      await window.researchNotebook.trash.move({ entityType: 'block', id: block.id })
      await onTrashed()
    } catch (error) {
      onError(error)
    }
  }
  const answer = async () => {
    try {
      const created = await window.researchNotebook.blocks.create({
        noteId: block.noteId,
        type: 'answer',
        data: { text: '' }
      })
      await window.researchNotebook.relations.create({
        fromBlockId: created.id,
        toBlockId: block.id,
        relationType: 'responds_to'
      })
      await onSaved()
    } catch (error) {
      onError(error)
    }
  }
  const viewSource = async () => {
    try {
      const source = await window.researchNotebook.sources.getBlockSource({ blockId: block.id })
      if (source) {
        window.dispatchEvent(new CustomEvent('research-notebook:open-source', { detail: source }))
        onViewSource()
      }
    } catch (error) {
      onError(error)
    }
  }
  return (
    <section className={`semantic-block type-${block.type}`} data-item-id={block.id}>
      <div className="block-label">
        <GripVertical size={15} />
        <span>{label(block.type)}</span>
      </div>
      <div className="block-main">
        <div className="block-actions-trigger">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button ref={buttonRef} variant="icon" aria-label={`Actions for ${label(block.type)} block`}>
                <MoreHorizontal size={17} />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="menu-content" align="end">
                <DropdownMenu.Item className="menu-item" onSelect={() => void duplicate()}>
                  <Copy size={15} /> Duplicate
                </DropdownMenu.Item>
                <DropdownMenu.Item className="menu-item" disabled={!canMoveUp} onSelect={() => onMove(-1)}>
                  Move up
                </DropdownMenu.Item>
                <DropdownMenu.Item className="menu-item" disabled={!canMoveDown} onSelect={() => onMove(1)}>
                  Move down
                </DropdownMenu.Item>
                {block.type === 'question' && (
                  <DropdownMenu.Item className="menu-item" onSelect={() => void answer()}>
                    Add answer
                  </DropdownMenu.Item>
                )}
                {typeof block.data.sourceDocumentId === 'string' && (
                  <DropdownMenu.Item className="menu-item" onSelect={() => void viewSource()}>
                    View source
                  </DropdownMenu.Item>
                )}
                <DropdownMenu.Item className="menu-item" onSelect={() => setInspector(true)}>
                  <Link2 size={15} /> Inspector
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="menu-separator" />
                <DropdownMenu.Item className="menu-item destructive" onSelect={() => void trash()}>
                  <Trash2 size={15} /> Move to trash
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
        {textBased ? (
          <textarea
            aria-label={`${label(block.type)} block`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onBlur={() => void save()}
            onKeyDown={(event) => {
              if (event.key === '/' && !text) setInspector(false)
              if (event.altKey && event.key === 'ArrowUp') {
                event.preventDefault()
                onMove(-1)
              }
              if (event.altKey && event.key === 'ArrowDown') {
                event.preventDefault()
                onMove(1)
              }
            }}
            placeholder="Write your note…"
          />
        ) : (
          <AssetBlock block={block} onError={onError} />
        )}
        {typeof block.data.sourceDocumentId === 'string' && (
          <button className="provenance" onClick={() => void viewSource()}>
            <FileText size={14} /> Source document · PDF p.
            {typeof block.data.pdfPage === 'number' ? block.data.pdfPage : '–'} ↗
          </button>
        )}
      </div>
      <BlockInspector
        block={block}
        availableBlocks={availableBlocks}
        open={inspector}
        onOpenChange={(open) => {
          setInspector(open)
          if (!open) buttonRef.current?.focus()
        }}
        onSaved={onSaved}
        onError={onError}
        onTrash={trash}
        onViewSource={viewSource}
      />
    </section>
  )
}

function BlockInspector({
  block,
  availableBlocks,
  open,
  onOpenChange,
  onSaved,
  onError,
  onTrash,
  onViewSource
}: {
  block: Block
  availableBlocks: Block[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => Promise<void>
  onError: (error: unknown) => void
  onTrash: () => Promise<void>
  onViewSource: () => Promise<void>
}): ReactElement | null {
  const [relations, setRelations] = useState<BlockRelation[]>([])
  const [target, setTarget] = useState('')
  const [relationType, setRelationType] = useState<'explains' | 'responds_to' | 'comments_on' | 'summarizes'>(
    'explains'
  )
  const load = useCallback(async () => {
    try {
      setRelations(await window.researchNotebook.relations.list({ blockId: block.id }))
    } catch (error) {
      onError(error)
    }
  }, [block.id, onError])
  useEffect(() => {
    if (open) void load()
  }, [open, load])
  if (!open) return null
  const convert = async (type: TextBlockType) => {
    try {
      await window.researchNotebook.blocks.updateType({ blockId: block.id, type })
      await onSaved()
    } catch (error) {
      onError(error)
    }
  }
  const link = async () => {
    if (!target) return
    try {
      await window.researchNotebook.relations.create({ fromBlockId: block.id, toBlockId: target, relationType })
      setTarget('')
      await load()
    } catch (error) {
      onError(error)
    }
  }
  return (
    <div className="inspector-backdrop" role="presentation">
      <aside className="block-inspector" role="dialog" aria-modal="true" aria-label="Block inspector">
        <header>
          <div>
            <span className="eyebrow">Block inspector</span>
            <h3>{label(block.type)}</h3>
          </div>
          <Button variant="icon" aria-label="Close inspector" onClick={() => onOpenChange(false)}>
            <X size={18} />
          </Button>
        </header>
        <label>
          Convert block
          <select
            value={block.type}
            disabled={!textBlockTypes.includes(block.type as TextBlockType)}
            onChange={(event) => void convert(event.target.value as TextBlockType)}
          >
            {textBlockTypes.map((type) => (
              <option key={type} value={type}>
                {label(type)}
              </option>
            ))}
          </select>
        </label>
        {typeof block.data.sourceDocumentId === 'string' && (
          <Button variant="secondary" onClick={() => void onViewSource()}>
            View source provenance
          </Button>
        )}
        <div className="inspector-section">
          <strong>Relationships</strong>
          <div className="link-form">
            <select
              aria-label="Relation type"
              value={relationType}
              onChange={(event) => setRelationType(event.target.value as typeof relationType)}
            >
              <option value="explains">explains</option>
              <option value="responds_to">responds to</option>
              <option value="comments_on">comments on</option>
              <option value="summarizes">summarizes</option>
            </select>
            <select aria-label="Block to link" value={target} onChange={(event) => setTarget(event.target.value)}>
              <option value="">Link to…</option>
              {availableBlocks
                .filter(({ id }) => id !== block.id)
                .map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {label(candidate.type)}:{' '}
                    {typeof candidate.data.text === 'string'
                      ? candidate.data.text.slice(0, 42) || 'Untitled'
                      : candidate.id.slice(0, 8)}
                  </option>
                ))}
            </select>
            <Button variant="secondary" disabled={!target} onClick={() => void link()}>
              Link
            </Button>
          </div>
          {relations.map((relation) => (
            <div className="relation" key={relation.id}>
              <span>{label(relation.relationType)}</span>
              <button
                aria-label="Remove relation"
                onClick={() =>
                  void window.researchNotebook.relations.remove({ relationId: relation.id }).then(load).catch(onError)
                }
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="inspector-section metadata">
          <strong>Metadata</strong>
          <code>{JSON.stringify(block.metadata || {}, null, 2)}</code>
        </div>
        <Button variant="danger" onClick={() => void onTrash()}>
          Move to trash
        </Button>
      </aside>
    </div>
  )
}

function AssetBlock({ block, onError }: { block: Block; onError: (error: unknown) => void }): ReactElement {
  const [url, setUrl] = useState('')
  const assetId = typeof block.data.assetId === 'string' ? block.data.assetId : null
  useEffect(() => {
    if (!assetId) return
    void window.researchNotebook.assets.dataUrl({ assetId }).then(setUrl).catch(onError)
  }, [assetId, onError])
  if (!assetId) return <p className="asset-missing">Missing asset reference.</p>
  if (block.type === 'image' || block.type === 'screenshot')
    return url ? (
      <img
        className="asset-image"
        src={url}
        alt={typeof block.data.filename === 'string' ? block.data.filename : 'Attached asset'}
      />
    ) : (
      <p>Loading image…</p>
    )
  if (block.type === 'audio')
    return (
      <div className="audio-block">
        <Volume2 size={18} />
        {url ? (
          <audio controls src={url}>
            Audio playback is unavailable.
          </audio>
        ) : (
          <p>Loading recording…</p>
        )}
        <TranscriptionPanel block={block} onError={onError} />
      </div>
    )
  return url ? (
    <a
      className="asset-file"
      href={url}
      download={typeof block.data.filename === 'string' ? block.data.filename : undefined}
    >
      Download attached file
    </a>
  ) : (
    <p>Loading file…</p>
  )
}

function AudioRecorder({
  noteId,
  onSaved,
  onError
}: {
  noteId: string
  onSaved: () => Promise<void>
  onError: (error: unknown) => void
}): ReactElement {
  const [recording, setRecording] = useState(false)
  const chunks = useRef<Float32Array[]>([])
  const session = useRef<{ stream: MediaStream; context: AudioContext; processor: ScriptProcessorNode } | null>(null)
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000 } })
      const context = new AudioContext({ sampleRate: 16000 })
      const processor = context.createScriptProcessor(4096, 1, 1)
      chunks.current = []
      processor.onaudioprocess = (event) => chunks.current.push(new Float32Array(event.inputBuffer.getChannelData(0)))
      context.createMediaStreamSource(stream).connect(processor)
      processor.connect(context.destination)
      session.current = { stream, context, processor }
      setRecording(true)
    } catch (error) {
      onError(error)
    }
  }
  const stop = async () => {
    const current = session.current
    if (!current) return
    setRecording(false)
    current.processor.disconnect()
    current.stream.getTracks().forEach((track) => track.stop())
    await current.context.close()
    const samples = chunks.current.reduce((size, chunk) => size + chunk.length, 0)
    const wav = new ArrayBuffer(44 + samples * 2)
    const view = new DataView(wav)
    const write = (offset: number, value: string) =>
      [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)))
    write(0, 'RIFF')
    view.setUint32(4, 36 + samples * 2, true)
    write(8, 'WAVEfmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, 16000, true)
    view.setUint32(28, 32000, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    write(36, 'data')
    view.setUint32(40, samples * 2, true)
    let offset = 44
    chunks.current.forEach((chunk) =>
      chunk.forEach((sample) => {
        view.setInt16(offset, Math.max(-1, Math.min(1, sample)) * 0x7fff, true)
        offset += 2
      })
    )
    try {
      const bytes = new Uint8Array(wav)
      let binary = ''
      bytes.forEach((byte) => {
        binary += String.fromCharCode(byte)
      })
      await window.researchNotebook.assets.saveRecording({ noteId, wavBase64: btoa(binary) })
      await onSaved()
    } catch (error) {
      onError(error)
    } finally {
      session.current = null
    }
  }
  return (
    <div className="audio-recorder-control">
      <Button
        variant={recording ? 'danger' : 'ghost'}
        size="sm"
        aria-pressed={recording}
        onClick={() => void (recording ? stop() : start())}
      >
        <Volume2 size={15} /> {recording ? 'Stop recording' : 'Record audio'}
      </Button>
      {recording && (
        <span className="recording-indicator" role="status" aria-live="polite">
          <span className="recording-dot" />
          <span>Recording</span>
          <span className="recording-waves" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((bar) => (
              <i key={bar} style={{ '--wave-delay': `${bar * 90}ms` } as CSSProperties} />
            ))}
          </span>
        </span>
      )}
    </div>
  )
}

function TranscriptionPanel({ block, onError }: { block: Block; onError: (error: unknown) => void }): ReactElement {
  const [runs, setRuns] = useState<import('../../../../shared/domain').TranscriptionRun[]>([])
  const [provider, setProvider] = useState<'local' | 'openrouter'>('local')
  const [language, setLanguage] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(
    async () => setRuns(await window.researchNotebook.transcription.list({ blockId: block.id })),
    [block.id]
  )
  useEffect(() => {
    void load().catch(onError)
  }, [load, onError])
  const active = runs.find((run) => run.id === block.data.activeTranscriptionRunId) ?? runs[0]
  const start = async () => {
    setBusy(true)
    try {
      await window.researchNotebook.transcription.create({
        blockId: block.id,
        provider,
        language: language || undefined
      })
      await load()
    } catch (error) {
      onError(error)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="transcription">
      <div>
        <select
          aria-label="Transcription provider"
          value={provider}
          onChange={(event) => setProvider(event.target.value as typeof provider)}
        >
          <option value="local">Local Whisper</option>
          <option value="openrouter">OpenRouter</option>
        </select>
        <select aria-label="Language hint" value={language} onChange={(event) => setLanguage(event.target.value)}>
          <option value="">Detect language automatically</option>
          {transcriptionLanguages.map(([code, name]) => (
            <option key={code} value={code}>
              {name} ({code})
            </option>
          ))}
        </select>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void start()}>
          Transcribe
        </Button>
      </div>
      {active && (
        <small>
          {active.provider} · {active.status}
          {active.transcriptText ? ` · ${active.transcriptText}` : ''}
        </small>
      )}
    </div>
  )
}
