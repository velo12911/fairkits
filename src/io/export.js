export function downloadCsv(filename, content) {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    throw new Error("CSV downloads are only available in a browser.");
  }
  if (typeof filename !== "string" || !filename.trim()) {
    throw new TypeError("Filename must be a non-empty string.");
  }
  if (typeof content !== "string") {
    throw new TypeError("CSV content must be a string.");
  }

  const csv = content.startsWith("\uFEFF") ? content : `\uFEFF${content}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.style.display = "none";

  try {
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}