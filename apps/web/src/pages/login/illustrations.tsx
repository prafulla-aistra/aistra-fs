/**
 * Original illustrations for the sign-in showcase: flat inline SVG in the theme colours,
 * drawn for the ink-navy panel. No stock images or external files (no licensing, works offline).
 * Decorative only (aria-hidden); each slide's title and text carry the meaning.
 */

const C = {
  ink: '#14112B',
  inkLight: '#231E45',
  inkLine: '#3A3366',
  teal: '#6C48F2',
  tealBright: '#A996FF',
  mint: '#F0ECFE',
  paper: '#FFFFFF',
  rule: '#E3E0EE',
  muted: '#A9A4C4',
  amber: '#D97706',
  amberSoft: '#FCD9A8',
  red: '#E0685E',
};

const font = { fontFamily: 'Inter Variable, Inter, system-ui, sans-serif' } as const;

function Svg({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <svg
      viewBox="0 0 520 340"
      className="h-auto w-full"
      aria-hidden="true"
      data-illustration={title}
      style={font}
    >
      {children}
    </svg>
  );
}

/** A sheet of paper with a coloured header band and label. */
function Sheet({
  x,
  y,
  w,
  h,
  label,
  band = C.teal,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  band?: string;
}) {
  return (
    <g>
      <rect x={x + 4} y={y + 6} width={w} height={h} rx="10" fill="#000" opacity=".18" />
      <rect x={x} y={y} width={w} height={h} rx="10" fill={C.paper} />
      <path
        d={`M${x} ${y + 10}a10 10 0 0 1 10-10h${w - 20}a10 10 0 0 1 10 10v18H${x}z`}
        fill={band}
      />
      <text x={x + 12} y={y + 19} fontSize="11.5" fontWeight="600" fill={C.paper}>
        {label}
      </text>
    </g>
  );
}

function Tick({
  cx,
  cy,
  r = 11,
  fill = C.teal,
  stroke = C.paper,
}: {
  cx: number;
  cy: number;
  r?: number;
  fill?: string;
  stroke?: string;
}) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={fill} />
      <path
        d={`M${cx - r * 0.42} ${cy + r * 0.02}l${r * 0.3} ${r * 0.3} ${r * 0.55}-${r * 0.6}`}
        fill="none"
        stroke={stroke}
        strokeWidth={r * 0.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
}

function Arrow({ d, color = C.tealBright }: { d: string; color?: string }) {
  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="1 7"
      />
    </g>
  );
}

// ---------------------------------------------------------------------------
// 1. Statutory FS preparation: trial balance → mapping → balance sheet, P&L and notes
// ---------------------------------------------------------------------------

export function StatutoryIllustration() {
  const tbRows = [
    { label: 62, amount: '12,40,500', dr: true },
    { label: 48, amount: '3,86,200', dr: true },
    { label: 70, amount: '8,15,000', dr: false },
    { label: 40, amount: '2,10,450', dr: true },
    { label: 56, amount: '5,22,150', dr: false },
    { label: 44, amount: '1,40,000', dr: true },
  ];
  const categories = [
    { y: 92, label: 'Assets' },
    { y: 132, label: 'Liabilities' },
    { y: 172, label: 'Income' },
    { y: 212, label: 'Expenses' },
  ];
  const links = [0, 3, 1, 2, 3, 0];

  return (
    <Svg title="Statutory FS preparation">
      {/* Trial balance */}
      <Sheet x={16} y={38} w={170} h={250} label="Trial balance · INR" />
      {tbRows.map((r, i) => {
        const y = 86 + i * 28;
        return (
          <g key={i}>
            <rect x={30} y={y - 7} width={r.label} height={7} rx="3.5" fill={C.rule} />
            <text
              x={172}
              y={y}
              fontSize="10"
              textAnchor="end"
              fill={r.dr ? C.ink : C.teal}
              fontWeight="500"
            >
              {r.dr ? '' : '('}₹{r.amount}
              {r.dr ? '' : ')'}
            </text>
            <circle cx={186} cy={y - 3} r="3" fill={C.tealBright} />
          </g>
        );
      })}
      <line x1={30} y1={256} x2={172} y2={256} stroke={C.ink} strokeWidth="1" />
      <text x={30} y={274} fontSize="10.5" fontWeight="600" fill={C.ink}>
        Net
      </text>
      <text x={150} y={274} fontSize="10.5" fontWeight="700" fill={C.teal} textAnchor="end">
        0.00
      </text>
      <Tick cx={166} cy={270} r={8} />

      {/* Mapping lines */}
      {links.map((c, i) => (
        <path
          key={i}
          d={`M189 ${83 + i * 28} C 215 ${83 + i * 28}, 215 ${categories[c]!.y}, 236 ${categories[c]!.y}`}
          fill="none"
          stroke={C.tealBright}
          strokeWidth="1.5"
          opacity=".75"
        />
      ))}
      {categories.map((c) => (
        <g key={c.label}>
          <rect
            x={236}
            y={c.y - 13}
            width={82}
            height={26}
            rx="13"
            fill={C.inkLight}
            stroke={C.inkLine}
          />
          <text
            x={277}
            y={c.y + 4}
            fontSize="11"
            textAnchor="middle"
            fill={C.mint}
            fontWeight="500"
          >
            {c.label}
          </text>
        </g>
      ))}
      <text x={277} y={260} fontSize="10.5" textAnchor="middle" fill={C.muted}>
        Mapping
      </text>
      <Arrow d="M322 152 H350" />

      {/* Statements */}
      <Sheet x={396} y={70} w={110} h={150} label="Notes" band={C.inkLine} />
      <Sheet x={378} y={96} w={116} h={156} label="Profit & loss" band="#5935DB" />
      <Sheet x={358} y={122} w={124} h={172} label="Balance sheet" />
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <rect
            x={372}
            y={168 + i * 20}
            width={i === 4 ? 44 : 60}
            height={6}
            rx="3"
            fill={C.rule}
          />
          <rect
            x={440}
            y={168 + i * 20}
            width={28}
            height={6}
            rx="3"
            fill={i === 4 ? C.teal : '#CFC8E6'}
          />
        </g>
      ))}
      <line x1={438} y1={262} x2={470} y2={262} stroke={C.ink} />
      <line x1={438} y1={265} x2={470} y2={265} stroke={C.ink} />
      <Tick cx={474} cy={130} r={13} fill={C.tealBright} stroke={C.ink} />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// 2. Consolidation: entity tree (Veracity → Unconstrained → India → US) → group statement
// ---------------------------------------------------------------------------

function Node({
  x,
  y,
  code,
  ccy,
  highlight = false,
}: {
  x: number;
  y: number;
  code: string;
  ccy: string;
  highlight?: boolean;
}) {
  return (
    <g>
      <rect
        x={x - 36}
        y={y - 15}
        width={72}
        height={30}
        rx="15"
        fill={highlight ? C.teal : C.inkLight}
        stroke={highlight ? C.tealBright : C.inkLine}
        strokeWidth="1.5"
      />
      <text x={x - 20} y={y + 4} fontSize="11.5" fontWeight="700" fill={C.paper}>
        {code}
      </text>
      <text
        x={x + 26}
        y={y + 4}
        fontSize="10.5"
        textAnchor="end"
        fill={highlight ? C.mint : C.muted}
      >
        {ccy}
      </text>
    </g>
  );
}

export function ConsolidationIllustration() {
  const edge = (x1: number, y1: number, x2: number, y2: number) => (
    <path
      d={`M${x1} ${y1 - 15} V${(y1 + y2) / 2} H${x2} V${y2 + 15}`}
      fill="none"
      stroke={C.inkLine}
      strokeWidth="2"
    />
  );
  return (
    <Svg title="Consolidation">
      {/* Tree, bottom-up: VM → VS → UC → IN → US */}
      {edge(62, 300, 62, 244)}
      {edge(62, 244, 150, 186)}
      {edge(150, 186, 150, 128)}
      {edge(62, 186, 150, 128)}
      {edge(238, 186, 150, 128)}
      {edge(150, 128, 150, 70)}
      <Node x={62} y={300} code="VM" ccy="LKR" />
      <Node x={62} y={244} code="VS" ccy="SGD" />
      <Node x={62} y={186} code="AE" ccy="AED" />
      <Node x={150} y={186} code="UC" ccy="$" />
      <Node x={238} y={186} code="UK" ccy="£" />
      <Node x={150} y={128} code="IN" ccy="₹" />
      <Node x={150} y={70} code="US" ccy="$" highlight />
      <text x={150} y={34} fontSize="10.5" textAnchor="middle" fill={C.muted}>
        Levels roll up bottom-first
      </text>
      <Arrow d="M192 70 H300" />

      {/* Group statement with eliminations */}
      <Sheet x={306} y={46} w={198} h={250} label="Consolidated · Aistra group" />
      {[
        ['Revenue', '$ 4.82m', C.ink],
        ['IC revenue', '− 0.36m', C.red],
        ['Expenses', '$ 3.10m', C.ink],
        ['IC expense', '+ 0.36m', C.red],
        ['NCI (41.51%)', '$ 0.22m', C.ink],
      ].map(([label, amount, colour], i) => {
        const y = 98 + i * 30;
        const ic = colour === C.red;
        return (
          <g key={label}>
            <text
              x={320}
              y={y}
              fontSize="11"
              fill={ic ? '#B42318' : C.ink}
              fontWeight={ic ? 600 : 400}
            >
              {label}
            </text>
            <text
              x={490}
              y={y}
              fontSize="11"
              textAnchor="end"
              fill={ic ? '#B42318' : C.ink}
              fontWeight="600"
            >
              {amount}
            </text>
            {ic && (
              <line
                x1={320}
                y1={y - 4}
                x2={490}
                y2={y - 4}
                stroke="#B42318"
                strokeWidth="1"
                opacity=".45"
              />
            )}
          </g>
        );
      })}
      <rect x={318} y={244} width={174} height={30} rx="8" fill={C.mint} />
      <text x={330} y={263} fontSize="11" fontWeight="700" fill={C.teal}>
        Group profit
      </text>
      <text x={482} y={263} fontSize="11.5" fontWeight="700" textAnchor="end" fill={C.teal}>
        $ 1.50m
      </text>
      <g transform="translate(410 22)">
        <rect width={96} height={24} rx="12" fill={C.red} />
        <text x={48} y={16} fontSize="10.5" fontWeight="600" textAnchor="middle" fill={C.paper}>
          Eliminations
        </text>
      </g>
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// 3. Controls and sign-off: checklist, maker-checker approval, audit trail
// ---------------------------------------------------------------------------

function Person({
  cx,
  cy,
  label,
  colour,
}: {
  cx: number;
  cy: number;
  label: string;
  colour: string;
}) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={24} fill={colour} />
      <circle cx={cx} cy={cy - 6} r={8} fill={C.mint} />
      <path d={`M${cx - 13} ${cy + 15} a13 11 0 0 1 26 0`} fill={C.mint} />
      <text x={cx} y={cy + 42} fontSize="11" fontWeight="600" textAnchor="middle" fill={C.mint}>
        {label}
      </text>
    </g>
  );
}

export function ControlsIllustration() {
  const items = [
    { label: 'Trial balance uploaded', done: true },
    { label: 'Mapping reviewed', done: true },
    { label: 'Rates locked', done: true },
    { label: 'IC reconciled', done: true },
    { label: 'Reviewer sign-off', done: false },
  ];
  return (
    <Svg title="Controls and sign-off">
      {/* Checklist */}
      <Sheet x={16} y={40} w={200} h={250} label="Close checklist · Aug-2026" />
      {items.map((it, i) => {
        const y = 94 + i * 38;
        return (
          <g key={it.label}>
            {it.done ? (
              <Tick cx={38} cy={y} r={10} />
            ) : (
              <circle
                cx={38}
                cy={y}
                r={9}
                fill="none"
                stroke={C.amber}
                strokeWidth="2.5"
                strokeDasharray="4 3"
              />
            )}
            <text x={56} y={y + 4} fontSize="11.5" fill={C.ink} fontWeight={it.done ? 400 : 600}>
              {it.label}
            </text>
          </g>
        );
      })}
      <rect x={30} y={270} width={172} height={6} rx="3" fill={C.rule} />
      <rect x={30} y={270} width={138} height={6} rx="3" fill={C.teal} />

      {/* Maker → checker */}
      <Person cx={272} cy={78} label="Maker" colour={C.inkLight} />
      <Arrow d="M302 78 H386" />
      <Person cx={420} cy={78} label="Checker" colour={C.teal} />
      <g transform="rotate(-8 452 36)">
        <rect
          x={420}
          y={24}
          width={84}
          height={24}
          rx="6"
          fill="none"
          stroke={C.tealBright}
          strokeWidth="2"
        />
        <text
          x={462}
          y={40}
          fontSize="10.5"
          fontWeight="700"
          textAnchor="middle"
          fill={C.tealBright}
          letterSpacing=".08em"
        >
          APPROVED
        </text>
      </g>

      {/* Audit trail */}
      <rect x={244} y={152} width={262} height={138} rx="10" fill={C.inkLight} stroke={C.inkLine} />
      <text x={260} y={174} fontSize="11" fontWeight="600" fill={C.mint}>
        Audit trail
      </text>
      <line x1={266} y1={190} x2={266} y2={276} stroke={C.inkLine} strokeWidth="2" />
      {[
        ['10:02', 'Prepared by Priya', C.muted],
        ['10:45', 'Approved by Rahul', C.tealBright],
        ['10:46', 'Finalised · locked', C.amberSoft],
      ].map(([time, text, dot], i) => {
        const y = 198 + i * 34;
        return (
          <g key={time}>
            <circle cx={266} cy={y} r={5} fill={dot} />
            <text x={280} y={y + 4} fontSize="10.5" fill={C.muted}>
              {time}
            </text>
            <text x={316} y={y + 4} fontSize="11" fill={C.mint}>
              {text}
            </text>
          </g>
        );
      })}
      {/* Padlock on the finalised entry */}
      <g transform="translate(470 257)">
        <rect x={0} y={6} width={18} height={14} rx="3" fill={C.amberSoft} />
        <path d="M4 7V4a5 5 0 0 1 10 0v3" fill="none" stroke={C.amberSoft} strokeWidth="2.2" />
      </g>
    </Svg>
  );
}
