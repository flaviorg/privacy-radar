-- Patients table (PostgreSQL); the fixture is parsed, never applied.
CREATE TABLE patients (
  id text PRIMARY KEY,
  cpf varchar(14) UNIQUE,
  full_name text NOT NULL,
  diagnosis text,
  tags text[]
);

COMMENT ON COLUMN patients.cpf IS 'Brazilian taxpayer id';
ALTER TABLE patients ADD COLUMN mother_name text;
ALTER TABLE ONLY public.visits ADD COLUMN visitor_email text;
