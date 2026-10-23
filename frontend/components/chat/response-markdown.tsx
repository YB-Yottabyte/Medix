import {
  Children,
  type ComponentProps,
  cloneElement,
  isValidElement,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

type MarkdownProps<T extends "a" | "p" | "li"> = ComponentProps<T> & {
  node?: unknown;
};

function citationNumber(children: ReactNode): string | null {
  const parts = Children.toArray(children);
  const text = parts.every(
    (part) => typeof part === "string" || typeof part === "number"
  )
    ? parts.join("").trim()
    : "";
  return /^[1-9]\d{0,2}$/.test(text) ? text : null;
}

/** Keep a citation with the preceding word, without making a whole claim unbreakable. */
function attachCitations(children: ReactNode): ReactNode[] {
  const result: ReactNode[] = [];
  for (const child of Children.toArray(children)) {
    const citation =
      isValidElement<{ href?: string; children?: ReactNode }>(child) &&
      /^https:\/\//.test(child.props.href ?? "") &&
      citationNumber(child.props.children) !== null;
    let anchorIndex = result.length - 1;
    if (
      typeof result[anchorIndex] === "string" &&
      !(result[anchorIndex] as string).trim()
    ) {
      anchorIndex--;
    }
    const anchor = result[anchorIndex];
    if (
      citation &&
      isValidElement<{ className?: string; children?: ReactNode }>(anchor) &&
      anchor.props.className === "medix-citation-anchor"
    ) {
      result.splice(anchorIndex + 1);
      result[anchorIndex] = cloneElement(
        anchor,
        {},
        anchor.props.children,
        "\u00a0",
        child
      );
      continue;
    }
    const previous = result.at(-1);
    if (citation && typeof previous === "string") {
      const match = /^(.*?)(\S+)\s*$/s.exec(previous);
      if (match) {
        result.pop();
        if (match[1]) {
          result.push(match[1]);
        }
        result.push(
          <span
            className="medix-citation-anchor"
            key={`citation-${result.length}`}
          >
            {match[2]}
            {"\u00a0"}
            {child}
          </span>
        );
        continue;
      }
    }
    result.push(child);
  }
  return result;
}

/** Override the renderer's padded list items so spacing has one owner. */
export function ResponseListItem({
  children,
  node: _node,
  ...props
}: MarkdownProps<"li">) {
  return <li {...props}>{attachCitations(children)}</li>;
}

/** Numbered medical references stay attached to their own claims as quiet badges. */
export function ResponseLink({
  children,
  href,
  className,
  node: _node,
  ...props
}: MarkdownProps<"a">) {
  const text = citationNumber(children);
  const citation = text !== null && /^https:\/\//.test(href ?? "");
  const external = /^https?:\/\//.test(href ?? "");
  return (
    <a
      {...props}
      aria-label={
        citation ? `Open medical reference ${text}` : props["aria-label"]
      }
      className={cn(
        citation
          ? "medix-reference-citation"
          : "text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary",
        className
      )}
      href={href}
      rel={external ? "noopener noreferrer" : props.rel}
      target={external ? "_blank" : props.target}
      title={citation ? `Medical reference ${text}` : props.title}
    >
      {citation ? `[${text}]` : children}
    </a>
  );
}

/** Existing Markdown source footers remain available without interrupting the answer. */
export function ResponseParagraph({
  children,
  node: _node,
  ...props
}: MarkdownProps<"p">) {
  const parts = Children.toArray(children);
  const links = new Map<string, ReactNode>();
  for (const part of parts) {
    if (
      isValidElement<{ href?: string; children?: ReactNode }>(part) &&
      /^https:\/\//.test(part.props.href ?? "")
    ) {
      const href = part.props.href;
      if (!href) {
        continue;
      }
      if (!links.has(href)) {
        links.set(href, part);
      }
    }
  }
  const sourceFooter =
    typeof parts[0] === "string" &&
    /^Sources:\s*$/.test(parts[0]) &&
    links.size > 0;
  if (sourceFooter) {
    return (
      <details className="medix-response-sources">
        <summary>
          Sources <span>({links.size})</span>
        </summary>
        <ul className="medix-source-list">
          {[...links].map(([href, link]) => (
            <li key={href}>{link}</li>
          ))}
        </ul>
      </details>
    );
  }
  return <p {...props}>{attachCitations(children)}</p>;
}
