-- Full academic registry (Karnataka Degree Registry layout, DigiLocker NAD fields).
-- The credentials table stays the on-chain-anchored record; these tables hold
-- the institution's complete academic data behind it.

-- Universities: extra attributes on the existing institutions table.
ALTER TABLE institutions
  ADD COLUMN source_ref       TEXT,
  ADD COLUMN short_code       TEXT,
  ADD COLUMN univ_type        TEXT,
  ADD COLUMN regulator        TEXT,
  ADD COLUMN city             TEXT,
  ADD COLUMN state            TEXT,
  ADD COLUMN pincode          TEXT,
  ADD COLUMN established_year INTEGER,
  ADD COLUMN grading_system   TEXT,
  ADD COLUMN aishe_code       TEXT,
  ADD COLUMN ugc_recognised   BOOLEAN;

CREATE TABLE colleges (
  college_code     TEXT PRIMARY KEY,
  college_name     TEXT NOT NULL,
  institution_id   TEXT NOT NULL REFERENCES institutions (id),
  city             TEXT,
  autonomous       BOOLEAN,
  established_year INTEGER,
  source           TEXT
);

CREATE TABLE programs (
  program_id      TEXT PRIMARY KEY,
  institution_id  TEXT NOT NULL REFERENCES institutions (id),
  program_code    TEXT NOT NULL UNIQUE,
  degree_level    TEXT CHECK (degree_level IN ('UG', 'PG')),
  degree_name     TEXT NOT NULL,
  branch_code     TEXT,
  branch_name     TEXT,
  duration_years  INTEGER,
  total_credits   INTEGER,
  admission_modes TEXT
);

-- Students: identity attributes. Aadhaar and mobile are stored masked only.
ALTER TABLE students
  ADD COLUMN reg_no         TEXT,
  ADD COLUMN abc_apaar_id   TEXT,
  ADD COLUMN father_name    TEXT,
  ADD COLUMN mother_name    TEXT,
  ADD COLUMN dob            DATE,
  ADD COLUMN gender         TEXT,
  ADD COLUMN nationality    TEXT,
  ADD COLUMN category       TEXT,
  ADD COLUMN domicile       TEXT,
  ADD COLUMN aadhaar_masked TEXT CHECK (aadhaar_masked IS NULL OR aadhaar_masked ~ '^XXXX-XXXX-[0-9]{4}$'),
  ADD COLUMN mobile_masked  TEXT,
  ADD COLUMN photo_ref      TEXT;
CREATE INDEX students_reg_no_idx ON students (reg_no);

CREATE TABLE enrollments (
  enrollment_id       TEXT PRIMARY KEY,
  student_id          TEXT NOT NULL REFERENCES students (student_id),
  reg_no              TEXT,
  institution_id      TEXT NOT NULL REFERENCES institutions (id),
  college_code        TEXT REFERENCES colleges (college_code),
  program_id          TEXT REFERENCES programs (program_id),
  admission_year      INTEGER,
  academic_session    TEXT,
  admission_quota     TEXT,
  lateral_entry       BOOLEAN,
  medium              TEXT,
  status              TEXT,
  semesters_completed INTEGER
);
CREATE INDEX enrollments_student_idx ON enrollments (student_id);

CREATE TABLE semester_results (
  enrollment_id      TEXT NOT NULL REFERENCES enrollments (enrollment_id),
  semester           INTEGER NOT NULL,
  exam_session       TEXT,
  result_date        DATE,
  credits_registered INTEGER,
  credits_earned     INTEGER,
  sgpa               NUMERIC(4, 2),
  backlogs           INTEGER,
  result             TEXT,
  PRIMARY KEY (enrollment_id, semester)
);

-- The on-chain credential's lookup key can be the printed certificate number.
ALTER TABLE credentials ADD COLUMN certificate_no TEXT UNIQUE;

CREATE TABLE degree_certificates (
  certificate_id             TEXT PRIMARY KEY,
  credential_id              TEXT UNIQUE REFERENCES credentials (credential_id),
  certificate_serial_no      TEXT,
  provisional_cert_no        TEXT,
  consolidated_marks_card_no TEXT,
  enrollment_id              TEXT REFERENCES enrollments (enrollment_id),
  student_id                 TEXT REFERENCES students (student_id),
  reg_no                     TEXT,
  institution_id             TEXT REFERENCES institutions (id),
  college_code               TEXT REFERENCES colleges (college_code),
  program_id                 TEXT REFERENCES programs (program_id),
  degree_level               TEXT,
  degree_name                TEXT,
  branch                     TEXT,
  candidate_name             TEXT,
  dob                        DATE,
  total_credits_earned       INTEGER,
  cgpa_or_percent            NUMERIC(5, 2),
  grading_system             TEXT,
  equivalent_percentage      NUMERIC(5, 2),
  class_awarded              TEXT,
  month_of_passing           TEXT,
  year_of_passing            INTEGER,
  provisional_issue_date     DATE,
  convocation_no             TEXT,
  convocation_date           DATE,
  date_of_issue              DATE,
  signed_by                  TEXT,
  certificate_status         TEXT CHECK (certificate_status IN
                               ('ISSUED', 'PROVISIONAL_ONLY', 'REVOKED', 'WITHHELD', 'CANCELLED_DUPLICATE_ISSUED')),
  revocation_reason          TEXT,
  nad_uploaded               BOOLEAN,
  digilocker_uri             TEXT,
  canonical_string           TEXT,
  sha256_hash                TEXT CHECK (sha256_hash ~ '^[0-9a-f]{64}$')
);
CREATE INDEX degree_certificates_serial_idx ON degree_certificates (certificate_serial_no);
CREATE INDEX degree_certificates_student_idx ON degree_certificates (student_id);

-- DigiLocker NAD University Certificate CSV template, column names as in the template.
CREATE TABLE nad_awards (
  id                 BIGSERIAL PRIMARY KEY,
  org_name           TEXT, org_code TEXT, org_address TEXT, org_city TEXT, org_state TEXT, org_pin TEXT,
  academic_course_id TEXT, course_name TEXT, stream TEXT, session TEXT,
  regn_no            TEXT, rroll TEXT, abc_account_id TEXT,
  cname              TEXT, gender TEXT, dob TEXT, fname TEXT, mname TEXT, photo TEXT,
  result             TEXT, year INTEGER, month TEXT, division TEXT,
  cgpa               NUMERIC(5, 2), percent NUMERIC(5, 2), tot_credit INTEGER,
  doi                TEXT, cert_no TEXT, cert_type TEXT, department TEXT, univ_name TEXT
);
CREATE INDEX nad_awards_cert_no_idx ON nad_awards (cert_no);

-- Labelled verification test cases (ground truth for evaluation).
CREATE TABLE verification_requests (
  request_id              TEXT PRIMARY KEY,
  request_date            DATE,
  requester               TEXT,
  claimed_certificate_no  TEXT,
  claimed_reg_no          TEXT,
  claimed_name            TEXT,
  claimed_dob             TEXT,
  claimed_university      TEXT,
  claimed_degree          TEXT,
  claimed_branch          TEXT,
  claimed_cgpa_or_percent NUMERIC(5, 2),
  claimed_year_of_passing INTEGER,
  qr_hash_on_document     TEXT,
  expected_result         TEXT,
  failure_reason          TEXT
);

-- Same lock-down as migrations 002/003: no access through Supabase's public API.
ALTER TABLE colleges              ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE semester_results      ENABLE ROW LEVEL SECURITY;
ALTER TABLE degree_certificates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE nad_awards            ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_requests ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON colleges, programs, enrollments, semester_results, degree_certificates,
                      nad_awards, verification_requests FROM %I', r);
      EXECUTE format('REVOKE ALL ON SEQUENCE nad_awards_id_seq FROM %I', r);
    END IF;
  END LOOP;
END $$;
