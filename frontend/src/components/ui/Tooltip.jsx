import React, { useState, useRef } from 'react';
import { getAbbreviation } from '../../utils/abbreviations';

/**
 * Abbr — Wraps an abbreviation with a hover tooltip showing full form + description.
 *
 * Usage: <Abbr>LOP</Abbr>
 *        <Abbr code="PF">Provident Fund</Abbr>
 */
export function Abbr({ children, code }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef(null);

  const key = code || (typeof children === 'string' ? children.trim() : '');
  const info = getAbbreviation(key);

  if (!info) return <span>{children}</span>;

  const handleEnter = () => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setPos({
        top: rect.bottom + 6,
        left: rect.left + rect.width / 2,
      });
    }
    setShow(true);
  };

  return (
    <span className="relative inline-block">
      <span
        ref={ref}
        onMouseEnter={handleEnter}
        onMouseLeave={() => setShow(false)}
        className="border-b border-dashed border-slate-400 cursor-help"
      >
        {children}
      </span>
      {show && (
        <span
          className="fixed z-[100] px-3 py-2 rounded-lg bg-slate-800 text-white text-xs
            shadow-xl animate-fade-in pointer-events-none max-w-xs"
          style={{
            top: pos.top,
            left: pos.left,
            transform: 'translateX(-50%)',
          }}
        >
          <span className="font-bold text-blue-300">{key}</span>
          <span className="text-slate-300"> — </span>
          <span className="font-semibold">{info.full}</span>
          <br />
          <span className="text-slate-300 leading-tight">{info.desc}</span>
        </span>
      )}
    </span>
  );
}

/**
 * Generic Tooltip wrapper — shows custom tooltip text on hover.
 *
 * Usage: <Tip text="Explains something"><button>?</button></Tip>
 */
export function Tip({ children, text, className = '' }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef(null);

  const handleEnter = () => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setPos({
        top: rect.bottom + 6,
        left: rect.left + rect.width / 2,
      });
    }
    setShow(true);
  };

  return (
    <span className={`relative inline-block ${className}`}>
      <span
        ref={ref}
        onMouseEnter={handleEnter}
        onMouseLeave={() => setShow(false)}
      >
        {children}
      </span>
      {show && text && (
        <span
          className="fixed z-[100] px-3 py-2 rounded-lg bg-slate-800 text-white text-xs
            shadow-xl animate-fade-in pointer-events-none max-w-xs leading-relaxed"
          style={{
            top: pos.top,
            left: pos.left,
            transform: 'translateX(-50%)',
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

export default Abbr;
