"use client";

import PhaseNav from "./PhaseNav";

export default function ProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <PhaseNav />
      {children}
    </>
  );
}
