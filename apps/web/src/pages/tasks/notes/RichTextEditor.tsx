import {
  mergeAttributes,
  Node,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  EditorContent,
  type NodeViewProps,
} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Italic, List, ListOrdered, Sigma } from 'lucide-react';
import { forwardRef, useContext, useImperativeHandle } from 'react';
import type { FigureRefDto, RichNodeDto } from '@finance-close/shared';
import { cn } from '@/lib/utils';
import { CatalogContext } from './catalog-context';
import { figureDisplay } from './figures';

const MEASURE_LABEL: Record<FigureRefDto['measure'], string> = {
  current: 'current',
  comparative: 'comparative',
  variance: 'variance',
  variancePct: 'variance %',
};

function FigureChip({ node }: NodeViewProps) {
  const { catalog, indian } = useContext(CatalogContext);
  const ref = node.attrs as FigureRefDto;
  const item = catalog.find((c) => c.source === ref.source && c.key === ref.key);
  return (
    <NodeViewWrapper
      as="span"
      className="mx-0.5 inline-flex items-center rounded bg-mint px-1.5 py-0 font-medium text-primary tabular-nums ring-1 ring-primary/30"
      title={
        item
          ? `${item.label} – ${MEASURE_LABEL[ref.measure]} (live figure)`
          : 'Figure not available'
      }
      data-testid="figure-chip"
    >
      {figureDisplay(ref, catalog, indian)}
    </NodeViewWrapper>
  );
}

const FigureNode = Node.create({
  name: 'figure',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      source: { default: 'ACCOUNT' },
      key: { default: '' },
      measure: { default: 'current' },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-figure]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-figure': '' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(FigureChip);
  },
});

export interface RichTextHandle {
  insertFigure: (ref: FigureRefDto) => void;
  /** Replaces the first typed occurrence of `text` with a live figure. */
  replaceText: (text: string, ref: FigureRefDto) => boolean;
}

export const RichTextEditor = forwardRef<
  RichTextHandle,
  {
    doc: RichNodeDto;
    editable: boolean;
    onChange: (doc: RichNodeDto) => void;
    onInsertFigure: () => void;
    label: string;
  }
>(function RichTextEditor({ doc, editable, onChange, onInsertFigure, label }, handle) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        code: false,
        horizontalRule: false,
      }),
      FigureNode,
    ],
    content: doc as object,
    editable,
    immediatelyRender: true,
    onUpdate: ({ editor: e }) => onChange(e.getJSON() as RichNodeDto),
    editorProps: {
      attributes: {
        class:
          'prose-note min-h-20 rounded-b-md border border-t-0 bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        'aria-label': label,
      },
    },
  });

  useImperativeHandle(handle, () => ({
    insertFigure: (ref) =>
      editor
        ?.chain()
        .focus()
        .insertContent({ type: 'figure', attrs: ref })
        .insertContent(' ')
        .run(),
    replaceText: (text, ref) => {
      if (!editor) return false;
      let range: { from: number; to: number } | null = null;
      editor.state.doc.descendants((node, pos) => {
        if (range || !node.isText) return;
        const i = (node.text ?? '').indexOf(text);
        if (i >= 0) range = { from: pos + i, to: pos + i + text.length };
      });
      if (!range) return false;
      editor.chain().focus().insertContentAt(range, { type: 'figure', attrs: ref }).run();
      return true;
    },
  }));

  if (!editor) return null;
  const btn = (active: boolean, title: string, onClick: () => void, icon: React.ReactNode) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={!editable}
      onClick={onClick}
      className={cn(
        'rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40',
        active && 'bg-accent text-foreground',
      )}
    >
      {icon}
    </button>
  );
  return (
    <div>
      <div
        className="flex items-center gap-0.5 rounded-t-md border bg-muted/40 px-1 py-0.5 [&_svg]:size-4"
        role="toolbar"
        aria-label={`${label} formatting`}
      >
        {btn(
          editor.isActive('bold'),
          'Bold',
          () => editor.chain().focus().toggleBold().run(),
          <Bold />,
        )}
        {btn(
          editor.isActive('italic'),
          'Italic',
          () => editor.chain().focus().toggleItalic().run(),
          <Italic />,
        )}
        {btn(
          editor.isActive('bulletList'),
          'Bullets',
          () => editor.chain().focus().toggleBulletList().run(),
          <List />,
        )}
        {btn(
          editor.isActive('orderedList'),
          'Numbered list',
          () => editor.chain().focus().toggleOrderedList().run(),
          <ListOrdered />,
        )}
        <span className="mx-1 h-4 w-px bg-border" />
        <button
          type="button"
          disabled={!editable}
          onClick={onInsertFigure}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-primary hover:bg-mint disabled:opacity-40"
        >
          <Sigma /> Insert figure
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
});
