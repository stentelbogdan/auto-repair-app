const VALID_COUNTIES = [
  "AB",
  "AG",
  "AR",
  "BC",
  "BH",
  "BN",
  "BR",
  "BT",
  "BV",
  "BZ",
  "CJ",
  "CL",
  "CS",
  "CT",
  "CV",
  "DB",
  "DJ",
  "GJ",
  "GL",
  "GR",
  "HD",
  "HR",
  "IF",
  "IL",
  "IS",
  "MH",
  "MM",
  "MS",
  "NT",
  "OT",
  "PH",
  "SB",
  "SJ",
  "SM",
  "SV",
  "TL",
  "TM",
  "TR",
  "VL",
  "VN",
  "VS",
  "B",
];

export function formatLicensePlateInput(value: string) {
  const clean = value.toUpperCase().replace(/[^A-Z0-9]/g, "");

  let county = "";
  let numbers = "";
  let letters = "";

  for (const char of clean) {
    if (numbers.length === 0 && /[A-Z]/.test(char)) {
      const nextCounty = county + char;

      const canStillBecomeValid = VALID_COUNTIES.some((validCounty) =>
        validCounty.startsWith(nextCounty),
      );

      if (nextCounty.length <= 2 && canStillBecomeValid) {
        county = nextCounty;
      }

      continue;
    }

    const maxNumbers = county === "B" ? 3 : 2;

    if (
      VALID_COUNTIES.includes(county) &&
      numbers.length < maxNumbers &&
      /[0-9]/.test(char) &&
      letters.length === 0
    ) {
      numbers += char;
      continue;
    }

    if (
      VALID_COUNTIES.includes(county) &&
      numbers.length >= 1 &&
      letters.length < 3 &&
      /[A-Z]/.test(char)
    ) {
      letters += char;
    }
  }

  return [county, numbers, letters].filter(Boolean).join(" ");
}

export function formatLicensePlateForDb(value?: string) {
  const formatted = formatLicensePlateInput(value || "").trim();

  return formatted || null;
}

export function isValidLicensePlate(value: string) {
  const formatted = formatLicensePlateInput(value);

  const parts = formatted.split(" ");

  if (parts.length !== 3) {
    return false;
  }

  const [county, numbers, letters] = parts;

  if (!VALID_COUNTIES.includes(county)) {
    return false;
  }

  if (county === "B") {
    if (!/^\d{2,3}$/.test(numbers)) {
      return false;
    }
  } else {
    if (!/^\d{2}$/.test(numbers)) {
      return false;
    }
  }

  if (!/^[A-Z]{3}$/.test(letters)) {
    return false;
  }

  return true;
}

export function getLicensePlateError(value: string) {
  const clean = value.toUpperCase().replace(/[^A-Z0-9]/g, "");

  if (!clean) return "";

  const counties = [
    "AB","AG","AR","B","BC","BH","BN","BR","BT","BV","BZ",
    "CJ","CL","CS","CT","CV","DB","DJ","GJ","GL","GR","HD",
    "HR","IF","IL","IS","MH","MM","MS","NT","OT","PH","SB",
    "SJ","SM","SV","TL","TM","TR","VL","VN","VS"
  ];

  const county = clean.match(/^[A-Z]{1,2}/)?.[0] || "";

  if (!counties.includes(county)) {
    return "Județ inexistent.";
  }

  const maxNumbers = county === "B" ? 3 : 2;

  const numbers = clean.slice(county.length).match(/^\d+/)?.[0] || "";

  if (numbers.length < maxNumbers) {
    return `Numărul trebuie să conțină ${maxNumbers} cifre.`;
  }

  const letters = clean.slice(county.length + numbers.length);

  if (letters.length < 3) {
    return "Lipsesc cele trei litere finale.";
  }

  return "";
}
