'use strict';
// Database schema, as numbered migrations. Never edit one that has shipped; add the next.
// Ids are case-sensitive base64url, so id columns are ascii_bin.

const ID = 'VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin';
const TABLE = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';

module.exports = [
  {
    version: 1,
    name: 'initial schema',
    up: [
      `CREATE TABLE settings (
        id TINYINT UNSIGNED PRIMARY KEY,
        program_name VARCHAR(40) NOT NULL,
        monthly_price_cents INT UNSIGNED NOT NULL,
        demo_mode TINYINT(1) NOT NULL,
        qr_period_seconds SMALLINT UNSIGNED NOT NULL,
        perks TEXT NOT NULL,
        pos_key_hash CHAR(64) CHARACTER SET ascii NULL,
        pos_key_hint VARCHAR(8) NULL,
        pos_key_created_at DATETIME(3) NULL,
        media_secret CHAR(64) CHARACTER SET ascii NOT NULL,
        next_member_number INT UNSIGNED NOT NULL,
        updated_at DATETIME(3) NOT NULL
      ) ${TABLE}`,

      `CREATE TABLE images (
        id ${ID} PRIMARY KEY,
        kind ENUM('selfie', 'offer') NOT NULL,
        mime VARCHAR(20) NOT NULL,
        bytes MEDIUMBLOB NOT NULL,
        created_at DATETIME(3) NOT NULL
      ) ${TABLE}`,

      `CREATE TABLE users (
        id ${ID} PRIMARY KEY,
        role ENUM('member', 'cashier', 'admin') NOT NULL,
        name VARCHAR(60) NOT NULL,
        email VARCHAR(120) NOT NULL,
        phone VARCHAR(30) NOT NULL DEFAULT '',
        password_hash VARCHAR(200) CHARACTER SET ascii NOT NULL,
        must_change_password TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME(3) NOT NULL,
        password_changed_at DATETIME(3) NULL,
        last_login_at DATETIME(3) NULL,
        member_number INT UNSIGNED NULL,
        qr_secret VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
        selfie_image_id ${ID} NULL,
        selfie_uploaded_at DATETIME(3) NULL,
        subscription JSON NULL,
        payment_method JSON NULL,
        last_scanned_code_start BIGINT NULL,
        last_scan_at DATETIME(3) NULL,
        last_scanned_by_name VARCHAR(60) NULL,
        UNIQUE KEY users_email (email),
        UNIQUE KEY users_member_number (member_number),
        KEY users_role (role, created_at),
        CONSTRAINT users_selfie FOREIGN KEY (selfie_image_id) REFERENCES images (id) ON DELETE SET NULL
      ) ${TABLE}`,

      `CREATE TABLE offers (
        id ${ID} PRIMARY KEY,
        title VARCHAR(80) NOT NULL DEFAULT '',
        body TEXT NOT NULL,
        image_id ${ID} NULL,
        created_at DATETIME(3) NOT NULL,
        created_by ${ID} NULL,
        KEY offers_created (created_at),
        CONSTRAINT offers_image FOREIGN KEY (image_id) REFERENCES images (id) ON DELETE SET NULL
      ) ${TABLE}`,

      `CREATE TABLE invoices (
        seq INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        id ${ID} NOT NULL,
        user_id ${ID} NOT NULL,
        amount_cents INT UNSIGNED NOT NULL,
        period_start DATETIME(3) NOT NULL,
        period_end DATETIME(3) NOT NULL,
        created_at DATETIME(3) NOT NULL,
        status VARCHAR(16) NOT NULL,
        demo TINYINT(1) NOT NULL,
        card VARCHAR(40) NULL,
        UNIQUE KEY invoices_id (id),
        KEY invoices_user (user_id, created_at),
        CONSTRAINT invoices_user FOREIGN KEY (user_id) REFERENCES users (id)
      ) ${TABLE}`,

      `CREATE TABLE sessions (
        token_hash CHAR(64) CHARACTER SET ascii PRIMARY KEY,
        user_id ${ID} NOT NULL,
        created_at DATETIME(3) NOT NULL,
        expires_at DATETIME(3) NOT NULL,
        ip VARCHAR(45) NULL,
        user_agent VARCHAR(200) NULL,
        KEY sessions_user (user_id),
        KEY sessions_expires (expires_at),
        CONSTRAINT sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ${TABLE}`,

      `CREATE TABLE audit_log (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        at DATETIME(3) NOT NULL,
        actor_id ${ID} NULL,
        actor_role VARCHAR(10) NULL,
        action VARCHAR(40) NOT NULL,
        target VARCHAR(120) NULL,
        detail VARCHAR(500) NULL,
        ip VARCHAR(45) NULL,
        KEY audit_at (at),
        KEY audit_actor (actor_id, at)
      ) ${TABLE}`,
    ],
  },
];
