import fs from "fs";
import path from "path";

const PROFILE_DIR = path.join(process.cwd(), "backend", "profiles");

export default class ProfileManager {
  getPath(site) {
    return path.join(PROFILE_DIR, `${site}.json`);
  }

  async save(site, context) {
    await context.storageState({
      path: this.getPath(site),
    });
  }

  exists(site) {
    return fs.existsSync(this.getPath(site));
  }

  get(site) {
    return this.getPath(site);
  }
}
