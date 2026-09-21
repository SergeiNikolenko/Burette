export interface CsvParser {
  /** Feed a chunk of text; returns any records completed by it. */
  push(text: string): string[][];
  /** Emit the trailing record (call once at end of input). */
  flush(): string[][];
}

export interface CsvParserOptions {
  /** Field delimiter. Defaults to ",". */
  delimiter?: string;
}

/**
 * Incremental CSV parser. Written in a deliberately plain, closure-free style
 * so it can run in both the main thread and a worker without adaptation.
 */
export function createCsvParser(options?: CsvParserOptions): CsvParser {
  var delimiter = (options && options.delimiter) || ",";
  var record: string[] = [];
  var field = "";
  var inQuotes = false;
  var pendingQuote = false;
  var pendingCR = false;
  var fieldStarted = false;
  var sawFirstChar = false;

  function push(text: string): string[][] {
    var out: string[][] = [];
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);
      if (!sawFirstChar) {
        sawFirstChar = true;
        if (c === "\uFEFF") continue;
      }

      if (pendingCR) {
        pendingCR = false;
        record.push(field);
        field = "";
        out.push(record);
        record = [];
        fieldStarted = false;
        if (c === "\n") continue;
      }

      if (pendingQuote) {
        pendingQuote = false;
        if (c === '"') {
          field += '"';
          fieldStarted = true;
          continue;
        }
        inQuotes = false;
      }

      if (inQuotes) {
        if (c === '"') pendingQuote = true;
        else field += c;
        continue;
      }

      if (c === '"' && !fieldStarted) {
        inQuotes = true;
        fieldStarted = true;
      } else if (c === delimiter) {
        record.push(field);
        field = "";
        fieldStarted = false;
      } else if (c === "\r") {
        pendingCR = true;
      } else if (c === "\n") {
        record.push(field);
        field = "";
        out.push(record);
        record = [];
        fieldStarted = false;
      } else {
        field += c;
        fieldStarted = true;
      }
    }
    return out;
  }

  function flush(): string[][] {
    var out: string[][] = [];
    if (pendingQuote) {
      pendingQuote = false;
      inQuotes = false;
    }
    if (pendingCR) {
      pendingCR = false;
      record.push(field);
      field = "";
      out.push(record);
      record = [];
      fieldStarted = false;
      return out;
    }
    if (field.length > 0 || record.length > 0 || fieldStarted) {
      record.push(field);
      field = "";
      out.push(record);
      record = [];
      fieldStarted = false;
    }
    return out;
  }

  return { push: push, flush: flush };
}
