import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactElement
} from 'react'
import { createPortal } from 'react-dom'
import { Copy, FileText, GripVertical, Link2, MoreHorizontal, Plus, Trash2, Type, Volume2, X } from 'lucide-react'
import {
  textBlockTypes,
  type Block,
  type BlockRelation,
  type PageWorkspace as Workspace,
  type TextBlockType
} from '../../../../shared/domain'
import { useSaves } from '../../save-coordinator'
import type { BlockSource } from '../../../../shared/domain'
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
  reloadWorkspace: (activateId?: string) => Promise<void>
  loadMore: () => Promise<void>
  activeNoteId: string | null
  setActiveNoteId: (id: string | null) => void
  onError: (error: unknown) => void
  onChanged: () => Promise<void>
  onNoteRenamed?: (id: string, title: string) => void
  onTrashed: () => Promise<void>
  onViewSource: (source: BlockSource) => void
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
  onNoteRenamed,
  onTrashed,
  onViewSource,
  onUtilities
}: Props): ReactElement {
  const saves = useSaves()
  const [title, setTitle] = useState(workspace.title)
  useEffect(() => setTitle(workspace.title), [workspace.id, workspace.title])
  const createNote = async () => {
    try {
      await saves.flushEditors()
      const note = await window.researchNotebook.notes.create({ pageId: workspace.id, title: 'Untitled note' })
      await reloadWorkspace(note.id)
    } catch (error) {
      onError(error)
    }
  }
  const saveTitle = useCallback(async () => {
    if (title.trim() && title !== workspace.title) {
      await window.researchNotebook.pages.update({ pageId: workspace.id, title })
      await onChanged()
    }
  }, [title, workspace.title, workspace.id, onChanged])
  useEffect(() => {
    saves.editors.set(workspace.id, saveTitle)
    return () => {
      saves.editors.delete(workspace.id)
    }
  }, [saves, workspace.id, saveTitle])
  const movePageToTrash = async () => {
    try {
      await saves.flush()
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
            dir="auto"
            className="page-title"
            aria-label="Page title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => void saveTitle().catch(onError)}
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
            onRenamed={onNoteRenamed}
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
      {workspace.notes.length > 0 && (
        <Button className="bottom-add-note" variant="secondary" onClick={() => void createNote()}>
          <Plus size={16} /> Add note
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
  onRenamed,
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
  onRenamed?: (id: string, title: string) => void
  notebookId: string | null
  allBlocks: Block[]
  active: boolean
  setActive: () => void
  reloadWorkspace: (activateId?: string) => Promise<void>
  onError: (error: unknown) => void
  onTrashed: () => Promise<void>
  onViewSource: (source: BlockSource) => void
}): ReactElement {
  const saves = useSaves()
  const [noteTitle, setNoteTitle] = useState(note.title)
  useEffect(() => setNoteTitle(note.title), [note.title])
  const saveNoteTitle = useCallback(async () => {
    if (noteTitle.trim() && noteTitle !== note.title) {
      await window.researchNotebook.notes.update({ noteId: note.id, title: noteTitle })
      onRenamed?.(note.id, noteTitle)
    }
  }, [note.id, note.title, noteTitle, onRenamed])
  useEffect(() => {
    saves.editors.set(note.id, saveNoteTitle)
    return () => {
      saves.editors.delete(note.id)
    }
  }, [saves, note.id, saveNoteTitle])
  const [slashOpen, setSlashOpen] = useState(false)
  const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; position: 'before' | 'after' } | null>(null)
  const createBlock = async (type: TextBlockType = 'text') => {
    try {
      await window.researchNotebook.blocks.create({ noteId: note.id, type, data: { text: '' } })
      await reloadWorkspace()
    } catch (error) {
      onError(error)
    }
  }
  const attach = async (kind: 'image' | 'screenshot' | 'audio' | 'file') => {
    if (!notebookId) return
    try {
      await saves.flushEditors()
      const asset = await window.researchNotebook.assets.import({ notebookId, kind })
      if (asset) await window.researchNotebook.assets.attach({ noteId: note.id, assetId: asset.id, type: kind })
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
  const reorderBlocks = async (draggedId: string, targetId: string, position: 'before' | 'after') => {
    if (draggedId === targetId) return
    const ids = note.blocks.map(({ id }) => id)
    const from = ids.indexOf(draggedId)
    const target = ids.indexOf(targetId)
    if (from < 0 || target < 0) return
    ids.splice(from, 1)
    const targetAfterRemoval = ids.indexOf(targetId)
    ids.splice(targetAfterRemoval + (position === 'after' ? 1 : 0), 0, draggedId)
    try {
      await window.researchNotebook.blocks.reorder({ noteId: note.id, blockIds: ids })
      await reloadWorkspace()
    } catch (error) {
      onError(error)
    }
  }
  const startDragging = (event: DragEvent<HTMLButtonElement>, blockId: string) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', blockId)
    setDraggedBlockId(blockId)
  }
  const dragOverBlock = (event: DragEvent<HTMLElement>, blockId: string) => {
    const activeId = draggedBlockId ?? event.dataTransfer.getData('text/plain')
    if (!activeId || activeId === blockId) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const bounds = event.currentTarget.getBoundingClientRect()
    setDropTarget({ id: blockId, position: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after' })
  }
  const dropOnBlock = (event: DragEvent<HTMLElement>, blockId: string) => {
    event.preventDefault()
    const draggedId = draggedBlockId ?? event.dataTransfer.getData('text/plain')
    const position = dropTarget?.id === blockId ? dropTarget.position : 'before'
    setDraggedBlockId(null)
    setDropTarget(null)
    if (draggedId) void reorderBlocks(draggedId, blockId, position)
  }
  return (
    <article
      className={`note-document ${active ? 'focused-note' : ''}`}
      data-item-id={note.id}
      onFocusCapture={setActive}
    >
      <div className="note-heading">
        <input
          dir="auto"
          aria-label="Note title"
          value={noteTitle}
          onChange={(event) => setNoteTitle(event.target.value)}
          onBlur={() => void saveNoteTitle().catch(onError)}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            void saves
              .flush()
              .then(() => window.researchNotebook.trash.move({ entityType: 'note', id: note.id }))
              .then(onTrashed)
              .catch(onError)
          }
        >
          Move note to trash
        </Button>
      </div>
      <div className="note-recording-slot" data-recording-note={note.id} />
      {note.blocks.map((block, index) => (
        <BlockEditor
          key={block.id}
          block={block}
          onSlash={() => setSlashOpen(true)}
          availableBlocks={allBlocks}
          canMoveUp={index > 0}
          canMoveDown={index < note.blocks.length - 1}
          onMove={(direction) => void moveBlock(block, direction)}
          isDragging={draggedBlockId === block.id}
          dropPosition={dropTarget?.id === block.id ? dropTarget.position : null}
          onDragStart={(event) => startDragging(event, block.id)}
          onDragOver={(event) => dragOverBlock(event, block.id)}
          onDrop={(event) => dropOnBlock(event, block.id)}
          onDragEnd={() => {
            setDraggedBlockId(null)
            setDropTarget(null)
          }}
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
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            void saves
              .flushEditors()
              .then(() => saves.recorder?.start(note.id))
              .catch(onError)
          }
        >
          Record audio
        </Button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button variant="ghost" size="sm">
              Attach media
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="menu-content" align="start">
              {(['image', 'screenshot', 'audio', 'file'] as const).map((kind) => (
                <DropdownMenu.Item className="menu-item" key={kind} onSelect={() => void attach(kind)}>
                  Attach {kind}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <Popover.Root open={slashOpen} onOpenChange={setSlashOpen}>
          <Popover.Trigger asChild>
            <Button variant="ghost" className="slash-hint" aria-label="Open block command menu">
              <Type size={15} /> Type <kbd>/</kbd> for commands
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="slash-menu"
              side="top"
              align="start"
              onKeyDown={(event) => {
                const buttons = Array.from(event.currentTarget.querySelectorAll('button'))
                const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
                }
              }}
            >
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
    await saves.flush()
    await saves.recorder?.start(note.id).catch(onError)
  }
}

function BlockEditor({
  onSlash,
  block,
  availableBlocks,
  canMoveUp,
  canMoveDown,
  onMove,
  isDragging,
  dropPosition,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onSaved,
  onError,
  onTrashed,
  onViewSource
}: {
  onSlash: () => void
  block: Block
  availableBlocks: Block[]
  canMoveUp: boolean
  canMoveDown: boolean
  onMove: (direction: -1 | 1) => void
  isDragging: boolean
  dropPosition: 'before' | 'after' | null
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDrop: (event: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
  onSaved: () => Promise<void>
  onError: (error: unknown) => void
  onTrashed: () => Promise<void>
  onViewSource: (source: BlockSource) => void
}): ReactElement {
  const saves = useSaves()
  const [text, setText] = useState(typeof block.data.text === 'string' ? block.data.text : '')
  const [inspector, setInspector] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const textBased = textBlockTypes.includes(block.type as TextBlockType)
  useEffect(() => setText(typeof block.data.text === 'string' ? block.data.text : ''), [block.id, block.data.text])
  const save = useCallback(async () => {
    if (textBased && text !== block.data.text) {
      await window.researchNotebook.blocks.update({ blockId: block.id, data: { ...block.data, text } })
    }
  }, [text, textBased, block.id, block.data])
  useEffect(() => {
    if (textBased) saves.editors.set(block.id, save)
    return () => {
      saves.editors.delete(block.id)
    }
  }, [saves, block.id, textBased, save])
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
      const source = block.source ?? (await window.researchNotebook.sources.getBlockSource({ blockId: block.id }))
      if (source) {
        onViewSource(source)
      }
    } catch (error) {
      onError(error)
    }
  }
  return (
    <section
      className={`semantic-block type-${block.type}${isDragging ? ' is-dragging' : ''}${
        dropPosition ? ` drop-${dropPosition}` : ''
      }`}
      data-item-id={block.id}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="block-label">
        <button
          className="block-drag-handle"
          type="button"
          draggable
          aria-label={`Drag ${label(block.type)} block to reorder`}
          title="Drag to reorder"
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          <GripVertical size={15} />
        </button>
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
                {(Boolean(block.source) || typeof block.data.sourceDocumentId === 'string') && (
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
            dir="auto"
            aria-label={`${label(block.type)} block`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onBlur={() => void save().catch(onError)}
            onKeyDown={(event) => {
              if (event.key === '/' && !text) {
                event.preventDefault()
                onSlash()
              }
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
        {(Boolean(block.source) || typeof block.data.sourceDocumentId === 'string') && (
          <button className="provenance" onClick={() => void viewSource()}>
            <FileText size={14} /> Source document · PDF p.
            {block.source?.pdfPage ?? (typeof block.data.pdfPage === 'number' ? block.data.pdfPage : '–')}
            {block.source?.printedPage ? ` · print p. ${block.source.printedPage}` : ''} ↗
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
        {(Boolean(block.source) || typeof block.data.sourceDocumentId === 'string') && (
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
  const audio = useRef<HTMLAudioElement>(null)
  const [url, setUrl] = useState('')
  const [near, setNear] = useState(false)
  const target = useRef<HTMLDivElement>(null)
  const assetId = typeof block.data.assetId === 'string' ? block.data.assetId : null
  const image = block.type === 'image' || block.type === 'screenshot'
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true)
          observer.disconnect()
        }
      },
      { rootMargin: '300px' }
    )
    if (target.current) observer.observe(target.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!near || !assetId) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      if (!image) {
        const value = await window.researchNotebook.assets.dataUrl({ assetId })
        if (alive) setUrl(value)
        return
      }
      const input = { assetId, width: 800, height: 600 }
      let value = await window.researchNotebook.assets.thumbnailDataUrl(input)
      if (!value) {
        await window.researchNotebook.assets.requestThumbnail(input)
        let attempts = 0
        const poll = async () => {
          value = await window.researchNotebook.assets.thumbnailDataUrl(input)
          if (!alive) return
          if (value) setUrl(value)
          else if (++attempts < 20) timer = setTimeout(() => void poll().catch(onError), 1000)
        }
        if (alive) timer = setTimeout(() => void poll().catch(onError), 1000)
      } else if (alive) setUrl(value)
    }
    void load().catch((value) => {
      if (alive) onError(value)
    })
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [near, assetId, image, onError])
  return (
    <div ref={target} className="asset-container">
      {!assetId ? (
        <p className="asset-missing">Missing asset reference.</p>
      ) : image ? (
        <>
          {url ? (
            <button
              type="button"
              className="asset-preview"
              aria-label={`Open full-resolution image: ${
                typeof block.data.filename === 'string' ? block.data.filename : 'attached asset'
              }`}
              title="Open full-resolution image"
              onClick={() => void window.researchNotebook.assets.dataUrl({ assetId }).then(setUrl).catch(onError)}
            >
              <img
                loading="lazy"
                className="asset-image"
                src={url}
                alt={typeof block.data.filename === 'string' ? block.data.filename : 'Attached asset'}
              />
            </button>
          ) : (
            <div className="asset-loading">
              <p>Loading image preview…</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void window.researchNotebook.assets.dataUrl({ assetId }).then(setUrl).catch(onError)}
              >
                Load image
              </Button>
            </div>
          )}
        </>
      ) : block.type === 'audio' ? (
        <div className="audio-block">
          <Volume2 size={18} />
          {url ? <audio ref={audio} controls preload="none" src={url} /> : <p>Loading recording…</p>}
          <TranscriptionPanel
            block={block}
            onError={onError}
            onSeek={(seconds) => {
              if (audio.current) {
                audio.current.currentTime = seconds
                void audio.current.play().catch(onError)
              }
            }}
          />
        </div>
      ) : url ? (
        <a
          className="asset-file"
          href={url}
          download={typeof block.data.filename === 'string' ? block.data.filename : undefined}
        >
          Download attached file
        </a>
      ) : (
        <p>Loading file…</p>
      )}
    </div>
  )
}

export function AudioRecorder({
  noteId,
  onSaved,
  onError
}: {
  noteId: string | null
  onSaved: () => Promise<void>
  onError: (error: unknown) => void
}): ReactElement {
  const saves = useSaves()
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [visible, setVisible] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [destinationId, setDestinationId] = useState<string | null>(null)
  useEffect(() => {
    const locate = () =>
      setHost(destinationId ? document.querySelector<HTMLElement>(`[data-recording-note="${destinationId}"]`) : null)
    locate()
    const observer = new MutationObserver(locate)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [destinationId])
  useEffect(() => {
    if (!host || typeof IntersectionObserver === 'undefined') {
      setVisible(Boolean(host))
      return
    }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting))
    observer.observe(host)
    return () => observer.disconnect()
  }, [host])
  const destination = useRef<string | null>(null)
  const pendingAudio = useRef<string | null>(null)
  const recordingOperation = useRef<string | null>(null)
  const needsRefresh = useRef(false)
  const saving = useRef<Promise<void> | null>(null)
  const starting = useRef<Promise<void> | null>(null)
  const [failed, setFailed] = useState(false)
  const [recording, setRecording] = useState(false)
  const [inputLevel, setInputLevel] = useState(0)
  const [microphone, setMicrophone] = useState<'active' | 'muted' | 'disconnected'>('active')
  const chunks = useRef<Float32Array[]>([])
  type RecordingSession = {
    stream: MediaStream
    context: AudioContext
    source: MediaStreamAudioSourceNode
    analyser: AnalyserNode
    processor: ScriptProcessorNode
    meterFrame: number | null
  }
  const session = useRef<RecordingSession | null>(null)
  const stopMeter = useCallback((current: RecordingSession) => {
    if (current.meterFrame !== null) cancelAnimationFrame(current.meterFrame)
    current.meterFrame = null
  }, [])
  const start = async (target: string) => {
    if (session.current || pendingAudio.current || starting.current || saving.current || needsRefresh.current)
      throw new Error('Save the current recording before starting another.')
    destination.current = target
    setDestinationId(target)
    recordingOperation.current = crypto.randomUUID()
    const operation = (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000 } })
        const context = new AudioContext({ sampleRate: 16000 })
        const processor = context.createScriptProcessor(4096, 1, 1)
        const source = context.createMediaStreamSource(stream)
        const analyser = context.createAnalyser()
        analyser.fftSize = 512
        chunks.current = []
        processor.onaudioprocess = (event) => chunks.current.push(new Float32Array(event.inputBuffer.getChannelData(0)))
        source.connect(analyser)
        source.connect(processor)
        processor.connect(context.destination)
        const current: RecordingSession = {
          stream,
          context,
          source,
          analyser,
          processor,
          meterFrame: null
        }
        session.current = current
        setInputLevel(0)
        setMicrophone('active')
        const samples = new Uint8Array(analyser.fftSize)
        let lastMeter = 0
        const measure = (time: number) => {
          if (session.current !== current) return
          if (time - lastMeter < 50) {
            current.meterFrame = requestAnimationFrame(measure)
            return
          }
          lastMeter = time
          analyser.getByteTimeDomainData(samples)
          const rms = Math.sqrt(samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length)
          // Speech is normally subtle in an unamplified time-domain signal, so
          // map it to a readable meter without inventing motion during silence.
          setInputLevel(Math.min(1, rms * 7))
          current.meterFrame = requestAnimationFrame(measure)
        }
        stream.getAudioTracks().forEach((track) => {
          track.onmute = () => setMicrophone('muted')
          track.onunmute = () => setMicrophone('active')
          track.onended = () => {
            if (session.current === current) {
              stopMeter(current)
              setInputLevel(0)
              setMicrophone('disconnected')
            }
          }
        })
        await context.resume()
        current.meterFrame = requestAnimationFrame(measure)
        setRecording(true)
      } catch (error) {
        const current = session.current
        if (current) {
          stopMeter(current)
          current.stream.getTracks().forEach((track) => track.stop())
          current.processor.disconnect()
          current.source.disconnect()
          current.analyser.disconnect()
          void current.context.close()
          session.current = null
        }
        throw error
      }
    })()
    starting.current = operation
    try {
      await operation
    } finally {
      starting.current = null
    }
  }
  const stop = (): Promise<void> => {
    if (saving.current) return saving.current
    setIsSaving(true)
    const operation = (async () => {
      await starting.current
      const current = session.current
      if (!current && !pendingAudio.current) {
        if (needsRefresh.current) {
          await onSaved()
          needsRefresh.current = false
          setFailed(false)
        }
        return
      }
      if (current) {
        session.current = null
        setRecording(false)
        stopMeter(current)
        setInputLevel(0)
        current.processor.disconnect()
        current.analyser.disconnect()
        current.source.disconnect()
        current.stream.getTracks().forEach((track) => track.stop())
        await current.context.close().catch(() => undefined)
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
        const bytes = new Uint8Array(wav)
        let binary = ''
        bytes.forEach((byte) => {
          binary += String.fromCharCode(byte)
        })
        pendingAudio.current = btoa(binary)
      }
      try {
        await window.researchNotebook.assets.saveRecording({
          noteId: destination.current!,
          wavBase64: pendingAudio.current!,
          operationId: recordingOperation.current!
        })
        pendingAudio.current = null
        needsRefresh.current = true
        await onSaved()
        needsRefresh.current = false
        setFailed(false)
      } catch (error) {
        setFailed(true)
        throw error
      }
    })()
    saving.current = operation
    void operation
      .finally(() => {
        saving.current = null
        setIsSaving(false)
      })
      .catch(() => undefined)
    return operation
  }
  useEffect(() => {
    saves.setRecorder({ start, stop })
  })
  useEffect(
    () => () => {
      const current = session.current
      if (!current) return
      stopMeter(current)
      current.processor.disconnect()
      current.analyser.disconnect()
      current.source.disconnect()
      current.stream.getTracks().forEach((track) => track.stop())
      void current.context.close()
      session.current = null
    },
    [stopMeter]
  )
  const meterLevel = Math.pow(inputLevel, 0.65)
  const status =
    microphone === 'disconnected'
      ? 'Microphone disconnected'
      : microphone === 'muted'
        ? 'Microphone muted'
        : 'Recording'
  if (!recording && !failed && !isSaving) return <></>
  const destinationTitle =
    host?.closest('article')?.querySelector<HTMLInputElement>('[aria-label="Note title"]')?.value ?? 'Recording note'
  const controls = (
    <div className="audio-recorder-control" role="region" aria-label="Recording controls">
      <strong dir="auto">{destinationTitle}</strong>
      {isSaving && <span role="status">Saving recording…</span>}
      {failed && <span role="alert">Recording retained. Retry saving.</span>}
      <Button
        variant={recording ? 'danger' : 'ghost'}
        size="sm"
        aria-pressed={recording}
        disabled={isSaving || (!noteId && !recording && !failed)}
        onClick={() => void (recording || failed ? stop() : start(noteId!)).catch(onError)}
      >
        <Volume2 size={15} /> {failed ? 'Retry save' : recording ? 'Stop recording' : 'Saving…'}
      </Button>
      {recording && (
        <span className={`recording-indicator microphone-${microphone}`} role="status" aria-live="polite">
          <span className="recording-dot" />
          <span>{status}</span>
          <span className="recording-waves" aria-label={`Microphone input level ${Math.round(inputLevel * 100)}%`}>
            {[0.45, 0.72, 1, 0.72, 0.45].map((multiplier, bar) => (
              <i
                key={bar}
                style={
                  {
                    height: `${Math.round(3 + 14 * meterLevel * multiplier)}px`,
                    opacity: 0.4 + meterLevel * 0.6
                  } as CSSProperties
                }
              />
            ))}
          </span>
        </span>
      )}
    </div>
  )
  return (
    <>
      {host ? createPortal(controls, host) : controls}
      {host && !visible && (
        <div className="recording-fallback" role="status">
          <span dir="auto">
            {failed ? 'Recording needs save retry' : isSaving ? 'Saving recording' : 'Recording'} · {destinationTitle}
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              host.scrollIntoView({ block: 'center', behavior: 'smooth' })
              host.closest('article')?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
            }}
          >
            Jump to recording
          </Button>
        </div>
      )}
    </>
  )
}

function TranscriptionPanel({
  block,
  onError,
  onSeek
}: {
  block: Block
  onError: (error: unknown) => void
  onSeek: (seconds: number) => void
}): ReactElement {
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const activeRunId = useRef<string | null>(null)
  const [currentRunId, setCurrentRunId] = useState<string | null>(null)
  const saves = useSaves()
  const [provider, setProvider] = useState<'local' | 'openrouter'>('local')
  const [readiness, setReadiness] = useState<import('../../../../shared/domain').TranscriptionSettings | null>(null)
  useEffect(() => {
    let alive = true
    void window.researchNotebook.settings
      .transcription()
      .then((value) => {
        if (alive) setReadiness(value)
      })
      .catch((value) => {
        if (alive) onError(value)
      })
    return () => {
      alive = false
    }
  }, [onError, provider])
  const [runs, setRuns] = useState<import('../../../../shared/domain').TranscriptionRun[]>([])
  const [progress, setProgress] = useState<number | null>(null)
  const [language, setLanguage] = useState('')
  const [busy, setBusy] = useState(false)
  const report = useCallback(
    (value: unknown) => {
      if (mounted.current) onError(value)
    },
    [onError]
  )
  const load = useCallback(async () => {
    const nextRuns = await window.researchNotebook.transcription.list({ blockId: block.id })
    if (!mounted.current) return
    setRuns(nextRuns)
    const activeRun =
      nextRuns.find((run) => run.id === (activeRunId.current ?? block.data.activeTranscriptionRunId)) ?? nextRuns[0]
    if (!activeRun || activeRun.provider !== 'local' || !['queued', 'running'].includes(activeRun.status)) {
      setProgress(null)
      return
    }
    const jobs = await window.researchNotebook.jobs.list()
    if (!mounted.current) return
    setProgress(jobs.find((job) => job.transcriptionRunId === activeRun.id)?.progress ?? null)
  }, [block.data.activeTranscriptionRunId, block.id])
  useEffect(() => {
    void load().catch(report)
  }, [load, report])
  const canRun =
    provider === 'openrouter'
      ? Boolean(readiness?.openRouterConfigured)
      : Boolean(readiness?.localBinaryAvailable && readiness.localModelAvailable)
  const active = runs.find((run) => run.id === (currentRunId ?? block.data.activeTranscriptionRunId)) ?? runs[0]
  useEffect(() => {
    if (!active || !['queued', 'running'].includes(active.status)) return
    const timer = window.setInterval(() => void load().catch(report), 1200)
    return () => window.clearInterval(timer)
  }, [active, load, report])
  const start = async () => {
    setBusy(true)
    try {
      await saves.flushEditors()
      const created = await window.researchNotebook.transcription.create({
        blockId: block.id,
        provider,
        language: language || undefined
      })
      activeRunId.current = 'transcriptionRunId' in created ? created.transcriptionRunId : created.id
      setCurrentRunId(activeRunId.current)
      await load()
    } catch (error) {
      onError(error)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="transcription">
      <div className="transcription-setup">
        <p className="transcription-readiness" role="status">
          {!readiness
            ? 'Checking transcription prerequisites…'
            : provider === 'openrouter'
              ? readiness.openRouterConfigured
                ? 'Audio is sent to OpenRouter and its transcription provider. External service charges may apply.'
                : 'Configure an OpenRouter key in Settings.'
              : !readiness.localBinaryAvailable
                ? 'Whisper runtime is missing. Install the bundled runtime; downloading a model does not install the runtime.'
                : !readiness.localModelAvailable
                  ? 'Download and select a local model in Settings.'
                  : `Local runtime ready · ${readiness.selectedLocalModel?.displayName ?? 'Installed model'}`}
        </p>
        <div className="transcription-controls">
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
          <Button variant="secondary" size="sm" disabled={busy || !canRun} onClick={() => void start()}>
            Transcribe
          </Button>
        </div>
      </div>
      {active && (
        <div className="transcript-status" role="status">
          {active.provider} · {active.model} · {active.status}
          {progress !== null ? ` · ${progress}%` : ''}
          {active.errorMessage && <p className="danger-text">{active.errorMessage}</p>}
        </div>
      )}
      {active && ['failed', 'cancelled'].includes(active.status) && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            void window.researchNotebook.transcription
              .retry({ runId: active.id })
              .then((created) => {
                activeRunId.current = 'transcriptionRunId' in created ? created.transcriptionRunId : created.id
                setCurrentRunId(activeRunId.current)
                return load()
              })
              .catch(report)
          }
        >
          Retry transcription
        </Button>
      )}
      <TranscriptReview block={block} runs={runs} onSeek={onSeek} onError={report} />
    </div>
  )
}

function TranscriptReview({
  block,
  runs,
  onSeek,
  onError
}: {
  block: Block
  runs: import('../../../../shared/domain').TranscriptionRun[]
  onSeek: (seconds: number) => void
  onError: (error: unknown) => void
}): ReactElement {
  const saves = useSaves()
  const [selected, setSelected] = useState('')
  const completed = runs.filter((run) => run.status === 'completed')
  useEffect(() => {
    if (!selected && completed[0]) setSelected(completed[0].id)
  }, [selected, completed])
  const run = completed.find((r) => r.id === selected) ?? completed[0]
  const reviews = block.data.transcriptReviews as Record<string, { text: string }> | undefined
  const savedReviews = useRef(new Map<string, string>())
  const [text, setText] = useState('')
  const persisted = useRef('')
  const runId = run?.id
  useEffect(() => {
    const value = run ? (savedReviews.current.get(run.id) ?? reviews?.[run.id]?.text ?? run.transcriptText ?? '') : ''
    persisted.current = value
    setText(value)
    // Initialize per run; workspace refreshes must not overwrite dirty corrections.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId])
  const save = useCallback(async () => {
    if (!runId || text === persisted.current) return
    const updated = await window.researchNotebook.transcription.review({ runId, text })
    const updatedReviews = updated.data.transcriptReviews as Record<string, { text: string }> | undefined
    // Keep successful saves ahead of workspace props that may still contain older reviews.
    savedReviews.current.set(runId, updatedReviews?.[runId]?.text ?? text)
    persisted.current = text
  }, [runId, text])
  useEffect(() => {
    saves.editors.set(`transcript:${block.id}`, save)
    return () => {
      saves.editors.delete(`transcript:${block.id}`)
    }
  }, [saves, block.id, save])
  if (!run) return <></>
  return (
    <section className="transcript-review" aria-label="Transcript review">
      <div className="transcript-review-heading">
        <strong>Transcript review</strong>
        <select
          aria-label="Transcript run"
          value={run.id}
          onChange={(event) => {
            const id = event.target.value
            void save()
              .then(() => setSelected(id))
              .catch(onError)
          }}
        >
          {completed.map((r) => (
            <option key={r.id} value={r.id}>
              {r.model} · {new Date(r.createdAt).toLocaleString()}
            </option>
          ))}
        </select>
      </div>
      <p className="dialog-copy">
        Reviewed text is displayed and exported by default. Original segments retain their recognition timestamps.
      </p>
      <textarea
        dir="auto"
        aria-label="Reviewed transcript"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => void save().catch(onError)}
      />
      <details className="transcript-source">
        <summary>
          {run.segments.length ? `Timestamped source segments (${run.segments.length})` : 'Original recognition'}
        </summary>
        {run.segments.length ? (
          <ol className="transcript-segments">
            {run.segments.map((segment) => (
              <li key={segment.id}>
                <button
                  onClick={() => onSeek(segment.startMs / 1000)}
                  aria-label={`Play segment at ${segment.startMs / 1000} seconds`}
                >
                  {(segment.startMs / 1000).toFixed(1)}s
                </button>
                <span dir="auto">{segment.text}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p dir="auto" className="original-transcript">
            {run.transcriptText}
          </p>
        )}
      </details>
    </section>
  )
}
