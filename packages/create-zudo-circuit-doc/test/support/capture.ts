export interface Capture {
  write(chunk: string): void;
  text(): string;
}

export function createCapture(): Capture {
  let buffer = "";
  return {
    write(chunk: string) {
      buffer += chunk;
    },
    text() {
      return buffer;
    },
  };
}
