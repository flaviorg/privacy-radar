-- Row-level security: the parser rejects these statements; that's expected.
CREATE TABLE notes (
  id text PRIMARY KEY,
  body text
);
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY notes_owner ON notes USING (owner = current_user);
/* a block comment with an apostrophe: don't stop here; */
CREATE TABLE other (x text);
