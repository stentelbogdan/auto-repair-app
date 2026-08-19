import type { ReactNode } from "react";
import MechanicalDraftProvider from "./MechanicalDraftProvider";

export default function PostMechanicalLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <MechanicalDraftProvider>{children}</MechanicalDraftProvider>;
}
