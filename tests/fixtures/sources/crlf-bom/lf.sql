-- LF twin of crlf.sql (that one has CRLF line endings and a BOM).
CREATE TABLE patients (
  id text PRIMARY KEY,
  email text NOT NULL
);
COMMENT ON COLUMN patients.email IS 'contact e-mail';
INSERT INTO patients (id, email) VALUES ('p-1', 'someone@example.invalid');
