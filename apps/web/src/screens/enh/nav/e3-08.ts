import { FileArchive, ListOrdered } from "lucide-react";
import type { NavFragment, NavIconFragment, ScreenLoaderFragment } from "../../../fragments";

export { ar, en } from "../evidence/strings";

export const navFragment: NavFragment = {
  placements: [{ group: "setup", section: "control", itemKeys: ["evidence-pack", "sequence-gaps"] }],
  access: {
    "evidence-pack": { permission: "audit.evidence_pack.view" },
    "sequence-gaps": { permission: "audit.sequence_gaps.view" },
  },
};

export const screens = {
  "evidence-pack": () => import("../evidence/EvidencePackScreen").then((m) => ({ Component: m.EvidencePackScreen })),
  "sequence-gaps": () => import("../evidence/SequenceGapsScreen").then((m) => ({ Component: m.SequenceGapsScreen })),
} satisfies ScreenLoaderFragment;

export const icons: NavIconFragment = {
  items: { "evidence-pack": FileArchive, "sequence-gaps": ListOrdered },
};
