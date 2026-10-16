import { Pause, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  ConsolidationIllustration,
  ControlsIllustration,
  StatutoryIllustration,
} from './illustrations';

const SLIDES = [
  {
    title: 'Statutory FS preparation',
    text: 'Upload the trial balance, map it once, and produce the balance sheet, P&L and notes.',
    Illustration: StatutoryIllustration,
  },
  {
    title: 'Consolidation',
    text: 'Roll the group up level by level — Veracity, Unconstrained, India, US — with eliminations and NCI.',
    Illustration: ConsolidationIllustration,
  },
  {
    title: 'Controls and sign-off',
    text: 'Checklists, maker-checker approval and a complete audit trail before anything is finalised.',
    Illustration: ControlsIllustration,
  },
] as const;

const INTERVAL_MS = 7000;

function usePrefersReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/**
 * Auto-rotating product showcase. Pauses on hover and keyboard focus, has a pause button
 * (WCAG 2.2.2), dots to switch slides, and never auto-rotates for reduced-motion users.
 */
export function Showcase() {
  const reducedMotion = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [paused, setPaused] = useState(false);
  const rotating = !reducedMotion && !paused && !hovered && !focused;

  useEffect(() => {
    if (!rotating) return;
    const t = setTimeout(() => setIndex((i) => (i + 1) % SLIDES.length), INTERVAL_MS);
    return () => clearTimeout(t);
  }, [rotating, index]);

  return (
    <section
      aria-roledescription="carousel"
      aria-label="What Finance Close does"
      className="w-full max-w-xl"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <div className="relative">
        {SLIDES.map((s, i) => (
          <div
            key={s.title}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${SLIDES.length}: ${s.title}`}
            aria-hidden={i !== index}
            className={cn(
              'transition-opacity duration-700 ease-out',
              i === index
                ? 'relative opacity-100'
                : 'pointer-events-none absolute inset-0 opacity-0',
            )}
          >
            <div className="rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10">
              <s.Illustration />
            </div>
            <h2 className="mt-6 text-xl font-semibold text-white">{s.title}</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-sidebar-muted">{s.text}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <div className="flex gap-2" role="group" aria-label="Choose slide">
          {SLIDES.map((s, i) => (
            <button
              key={s.title}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Show slide ${i + 1}: ${s.title}`}
              aria-current={i === index}
              className={cn(
                'h-2 rounded-full transition-all focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none',
                i === index ? 'w-7 bg-teal-light' : 'w-2 bg-white/30 hover:bg-white/50',
              )}
            />
          ))}
        </div>
        {!reducedMotion && (
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? 'Play slideshow' : 'Pause slideshow'}
            className="rounded-md p-1 text-sidebar-muted hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
          >
            {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
          </button>
        )}
      </div>
    </section>
  );
}
