// Transport shape of the intake form: describes a request body, not storage.
export interface IntakeRequestDto {
  email: string;
  diagnosis: string;
  notes?: string;
}
