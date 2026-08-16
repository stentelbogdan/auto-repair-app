export type ProgressServiceType = "bodywork" | "mechanical";

export type ProgressStatus =
  | "Received"
  | "Disassembly"
  | "Body repair"
  | "Paint preparation"
  | "Painting"
  | "Polishing"
  | "Diagnosis"
  | "Parts ordered"
  | "In repair"
  | "Testing"
  | "Ready";

export type ProgressWorkflowStep = {
  status: ProgressStatus;
  label: string;
  index: number;
};

const createWorkflow = (
  steps: ReadonlyArray<readonly [ProgressStatus, string]>,
): readonly ProgressWorkflowStep[] =>
  steps.map(([status, label], index) => ({ status, label, index }));

export const bodyworkProgressWorkflow = createWorkflow([
  ["Received", "Primită"],
  ["Disassembly", "Demontare"],
  ["Body repair", "Tinichigerie"],
  ["Paint preparation", "Pregătire vopsire"],
  ["Painting", "Vopsire"],
  ["Polishing", "Polish"],
  ["Ready", "Gata"],
]);

export const mechanicalProgressWorkflow = createWorkflow([
  ["Received", "Primită"],
  ["Diagnosis", "Diagnoză"],
  ["Parts ordered", "Piese comandate"],
  ["In repair", "În reparație"],
  ["Testing", "Testare"],
  ["Ready", "Gata"],
]);

const progressLabels = new Map<ProgressStatus, string>(
  [...bodyworkProgressWorkflow, ...mechanicalProgressWorkflow].map(
    ({ status, label }) => [status, label],
  ),
);

const aliases: Record<string, ProgressStatus> = {
  received: "Received",
  primită: "Received",
  primita: "Received",
  disassembly: "Disassembly",
  demontare: "Disassembly",
  "body repair": "Body repair",
  tinichigerie: "Body repair",
  "paint preparation": "Paint preparation",
  "pregătire vopsire": "Paint preparation",
  "pregatire vopsire": "Paint preparation",
  painting: "Painting",
  vopsire: "Painting",
  polishing: "Polishing",
  polish: "Polishing",
  diagnosis: "Diagnosis",
  diagnoză: "Diagnosis",
  diagnoza: "Diagnosis",
  "parts ordered": "Parts ordered",
  "piese comandate": "Parts ordered",
  "in repair": "In repair",
  "în reparație": "In repair",
  "in reparatie": "In repair",
  testing: "Testing",
  testare: "Testing",
  ready: "Ready",
  gata: "Ready",
};

function normalizeAliasKey(status: string) {
  return status
    .trim()
    .toLocaleLowerCase("ro-RO")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\s+/g, " ");
}

function readableFallback(status: string) {
  const normalized = status
    .trim()
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\s+/g, " ");

  if (!normalized) return "";
  return normalized.charAt(0).toLocaleUpperCase("ro-RO") + normalized.slice(1);
}

export function getProgressWorkflow(
  serviceType?: string | null,
): readonly ProgressWorkflowStep[] {
  return serviceType === "mechanical"
    ? mechanicalProgressWorkflow
    : bodyworkProgressWorkflow;
}

export function normalizeProgressStatus(
  status?: string | null,
): ProgressStatus | null {
  if (!status) return null;
  return aliases[normalizeAliasKey(status)] ?? null;
}

export function formatProgressStatus(status?: string | null) {
  if (!status) return "";

  const normalizedStatus = normalizeProgressStatus(status);
  if (normalizedStatus) {
    return progressLabels.get(normalizedStatus) ?? readableFallback(status);
  }

  if (status === "in_progress") return "În lucru";
  if (status === "completed") return "Finalizată";

  return readableFallback(status);
}

export function isProgressStatusValidForWorkflow(
  status: string | null | undefined,
  serviceType?: string | null,
) {
  const normalizedStatus = normalizeProgressStatus(status);
  if (!normalizedStatus) return false;

  return getProgressWorkflow(serviceType).some(
    (step) => step.status === normalizedStatus,
  );
}
