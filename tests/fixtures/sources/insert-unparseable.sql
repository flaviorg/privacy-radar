-- An escaped quote the parser rejects; every literal must still be masked.
INSERT INTO patients (full_name, note) VALUES (E'it\'s Ana Example', 'second literal');
