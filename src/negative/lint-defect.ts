// DELIBERATE DEFECT - validation of the CI gate. Not for merge.
// @typescript-eslint/no-unused-vars must reject this.
export function greet(name: string): string {
  const unusedOnPurpose = 42;
  return `hello ${name}`;
}
