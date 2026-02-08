# WhatsApp Bold Normalize Patch

## Problem
LLMs output markdown bold as `**text**` (double) and bold-italic as `***text***` (triple asterisks). WhatsApp uses single asterisks `*text*` for bold. This causes raw asterisks to appear in WhatsApp messages instead of proper formatting.

## Solution
Regex replacement before sending to WhatsApp:
```
.replace(/\*{3}(.+?)\*{3}/g, "*_$1_*")  // ***text*** → *_text_* (bold italic)
.replace(/\*{2}(.+?)\*{2}/g, "*$1*")    // **text**  → *text*  (bold)
```

Order matters: triple first, then double.

## Files Modified

### 1. `src/web/auto-reply/deliver-reply.ts`
Auto-reply path (90% of messages). Applied before `convertMarkdownTables`.

```diff
-  const convertedText = convertMarkdownTables(replyResult.text || "", tableMode);
+  // Convert markdown bold/bold-italic to WhatsApp bold (single asterisks).
+  const boldNormalized = (replyResult.text || "")
+    .replace(/\*{3}(.+?)\*{3}/g, "*_$1_*")
+    .replace(/\*{2}(.+?)\*{2}/g, "*$1*");
+  const convertedText = convertMarkdownTables(boldNormalized, tableMode);
```

### 2. `src/web/outbound.ts`
Message tool / heartbeat path. Applied after `convertMarkdownTables`.

```diff
   text = convertMarkdownTables(text ?? "", tableMode);
+  // Convert markdown bold/bold-italic to WhatsApp bold (single asterisks).
+  // ***text*** or **text** → *text*
+  text = text.replace(/\*{3}(.+?)\*{3}/g, "*_$1_*").replace(/\*{2}(.+?)\*{2}/g, "*$1*");
```

## Notes
- Both paths must be patched — WhatsApp has two separate outbound routes
- The regex uses non-greedy matching (`+?`) to handle multiple bold segments per line
- Does not affect single asterisks (already correct for WhatsApp)
- Port to butley/openclaw fork when confirmed stable
