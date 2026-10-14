-- Telehealth clinic schema (PostgreSQL). The fixture is scanned, never applied.

CREATE TABLE clinics (
  cnpj text PRIMARY KEY,
  name text NOT NULL,
  address text
);

CREATE TABLE patients (
  id text PRIMARY KEY,
  full_name text,
  cpf text,
  nif_pt text,
  dni_es text,
  codice_fiscale text,
  email text,
  phone text,
  birth_date date,
  guardian_name text,
  diagnosis text,
  allergies text,
  blood_type text,
  obs jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE appointments (
  id text PRIMARY KEY,
  patient_id text NOT NULL REFERENCES patients (id),
  scheduled_at timestamptz NOT NULL,
  reminder_phone text,
  extra jsonb
);

COMMENT ON COLUMN patients.cpf IS 'Brazilian taxpayer id';

ALTER TABLE patients ADD COLUMN mother_name text;

-- seed (synthetic, checksum-valid): the clinic's demo rows
INSERT INTO clinics (cnpj, name) VALUES ('67.577.703/0001-58', 'Telehealth Demo Clinic');

INSERT INTO patients (id, cpf, nif_pt, dni_es, codice_fiscale) VALUES
  ('p-001', '245.452.155-56', NULL, NULL, 'VRDLCU88E52H501G'),
  ('p-002', NULL, '205174418', '61852415X', NULL),
  ('p-003', NULL, '297108972', 'Y4098832Q', NULL);
