PRAGMA foreign_keys = ON;

-- CLIMATIZADOR (1) --- (1) VAV / (1) --- (N) SALA via SALA.id_climatizador
CREATE TABLE IF NOT EXISTS CLIMATIZADOR (
  id_climatizador INTEGER PRIMARY KEY AUTOINCREMENT,
  nome            TEXT,
  stauts          TEXT,      -- conforme DER (provavel "status")
  capacidade      REAL
);

-- SALA  (FK id_climatizador -> CLIMATIZADOR)
CREATE TABLE IF NOT EXISTS SALA (
  id_sala         INTEGER PRIMARY KEY AUTOINCREMENT,
  nome            TEXT,
  andar           TEXT,
  status          TEXT,
  id_climatizador INTEGER,
  FOREIGN KEY (id_climatizador) REFERENCES CLIMATIZADOR (id_climatizador)
);

-- VAV  (FK id_sala -> SALA)  -- SALA 1 : 1 VAV (id_sala UNIQUE)
CREATE TABLE IF NOT EXISTS VAV (
  id_vav    INTEGER PRIMARY KEY AUTOINCREMENT,
  status    TEXT,
  abertura  REAL,
  vazao_ar  REAL,
  id_sala   INTEGER UNIQUE,
  FOREIGN KEY (id_sala) REFERENCES SALA (id_sala)
);

-- SENSOR  (FK id_sala -> SALA)  -- SALA 1 : N SENSOR
CREATE TABLE IF NOT EXISTS SENSOR (
  id_sensor INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo      TEXT,
  unidade   TEXT,
  status    TEXT,
  id_sala   INTEGER,
  FOREIGN KEY (id_sala) REFERENCES SALA (id_sala)
);

-- LIMITE_ALERTA  (FK id_sala -> SALA)  -- SALA 1 : N LIMITE_ALERTA
CREATE TABLE IF NOT EXISTS LIMITE_ALERTA (
  id_limite  INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo       TEXT,
  valor_min  REAL,
  valor_max  REAL,
  id_sala    INTEGER,
  FOREIGN KEY (id_sala) REFERENCES SALA (id_sala)
);

-- ALERTA  (FK id_sala -> SALA, FK id_sensor -> SENSOR)  -- SALA 1 : N ALERTA
CREATE TABLE IF NOT EXISTS ALERTA (
  id_alerta INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo      TEXT,
  mensagem  TEXT,
  nivel     TEXT,
  data_hora TEXT,
  id_sala   INTEGER,
  id_sensor INTEGER,
  FOREIGN KEY (id_sala)   REFERENCES SALA (id_sala),
  FOREIGN KEY (id_sensor) REFERENCES SENSOR (id_sensor)
);

-- LEITURA_SENSOR  (FK id_sensor -> SENSOR)  -- SENSOR 1 : N LEITURA_SENSOR
CREATE TABLE IF NOT EXISTS LEITURA_SENSOR (
  id_leitura           INTEGER PRIMARY KEY AUTOINCREMENT,
  valor                REAL,
  data_hora            TEXT,
  "qualidade-leitura"  TEXT,   -- conforme DER (nome com hifen)
  id_sensor            INTEGER,
  FOREIGN KEY (id_sensor) REFERENCES SENSOR (id_sensor)
);
