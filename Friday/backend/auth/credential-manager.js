// backend/auth/credential-manager.js

import fs from "fs";
import path from "path";
import crypto from "crypto";

const FILE = path.join(process.cwd(), "backend", "auth", "credentials.json");

// Move this to .env later
const SECRET = "Friday-Super-Secret-Key-Change-Me";

export default class CredentialManager {
  encrypt(text) {
    const cipher = crypto.createCipher("aes-256-cbc", SECRET);

    let encrypted = cipher.update(text, "utf8", "hex");

    encrypted += cipher.final("hex");

    return encrypted;
  }

  decrypt(text) {
    const decipher = crypto.createDecipher("aes-256-cbc", SECRET);

    let decrypted = decipher.update(text, "hex", "utf8");

    decrypted += decipher.final("utf8");

    return decrypted;
  }

  loadAll() {
    if (!fs.existsSync(FILE)) {
      return {};
    }

    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  }

  saveAll(data) {
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
  }

  save(site, username, password) {
    const data = this.loadAll();

    data[site] = {
      username,
      password: this.encrypt(password),
      updatedAt: new Date().toISOString(),
    };

    this.saveAll(data);
  }

  get(site) {
    const data = this.loadAll();

    if (!data[site]) {
      return null;
    }

    return {
      username: data[site].username,
      password: this.decrypt(data[site].password),
    };
  }

  remove(site) {
    const data = this.loadAll();

    delete data[site];

    this.saveAll(data);
  }
}
