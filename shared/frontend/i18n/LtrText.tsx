import React from 'react';

// Request numbers (REQ-2026-100001, QL-…) and phone numbers inside free text such as notification
// messages. In Hebrew text they would otherwise break at a hyphen and come out in the wrong order.
const LTR_TOKEN = /([A-Z]{2,5}-\d{4}-\d+|\+\d[\d\s-]{6,}\d)/g;

/**
 * Renders text with request numbers and phone numbers kept left-to-right and on one line,
 * like <bdi dir="ltr"> elsewhere in the UI.
 */
export const LtrText: React.FC<{ text: string | undefined | null }> = ({ text }) => {
  if (!text) return null;
  const parts = text.split(LTR_TOKEN);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <bdi key={i} dir="ltr" className="whitespace-nowrap">
            {part}
          </bdi>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </>
  );
};
