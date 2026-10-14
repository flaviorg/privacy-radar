import type { ReactNode } from "react";

type Props = { title: string; children?: ReactNode };

export const identity = <T,>(value: T): T => value;

export function Card({ title, children }: Props) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
