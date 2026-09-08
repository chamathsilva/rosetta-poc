// DELIBERATE DEFECT - validation of the CI gate. Not for merge.
// A type error that ESLint's non-type-checked recommended config cannot see,
// so the lint step passes and the typecheck step is the one that must fail.
export const answer: number = 'forty-two';
