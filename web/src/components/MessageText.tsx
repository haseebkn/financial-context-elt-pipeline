import { parseMessageBlocks, type MessagePart } from "../lib/message-parts.js";
import { CitationChip } from "./CitationChip.js";

function Inline({ parts }: { parts: MessagePart[] }) {
  return (
    <>
      {parts.map((part, i) => {
        switch (part.type) {
          case "citation":
            return <CitationChip key={i} rowId={part.rowId} />;
          case "bold":
            return <strong key={i}>{part.text}</strong>;
          case "code":
            return (
              <code key={i} className="message-code">
                {part.text}
              </code>
            );
          default:
            return <span key={i}>{part.text}</span>;
        }
      })}
    </>
  );
}

/**
 * Renders answer text as paragraphs and bullet lists, with [row_id] markers
 * replaced by citation chips and the agent's markdown (bold, inline code)
 * actually rendered rather than shown as literal asterisks and backticks.
 */
export function MessageText({ text }: { text: string }) {
  const blocks = parseMessageBlocks(text);

  return (
    <div className="message-text">
      {blocks.map((block, i) =>
        block.type === "list" ? (
          <ul key={i} className="message-list">
            {block.items.map((parts, j) => (
              <li key={j}>
                <Inline parts={parts} />
              </li>
            ))}
          </ul>
        ) : block.type === "table" ? (
          <div key={i} className="message-table-scroll">
            <table className="message-table">
              <thead>
                <tr>
                  {block.headers.map((parts, j) => (
                    <th key={j} scope="col">
                      <Inline parts={parts} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, j) => (
                  <tr key={j}>
                    {row.map((parts, k) => (
                      <td key={k}>
                        <Inline parts={parts} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p key={i}>
            <Inline parts={block.parts} />
          </p>
        )
      )}
    </div>
  );
}
