(function () {
  "use strict";

  const WORLD_RADIUS = 150;
  const EYE_HEIGHT = 1.65;
  const TOTAL_ENEMIES = 200;
  const WEAPON_DEFS = [
    { id: "rifle", name: "BR-17", mode: "自动步枪", magSize: 30, reserve: 90, damage: 34, headDamage: 60, fireDelay: 90, range: 82, recoil: 0.026, spread: 10 },
    { id: "smg", name: "VX-9", mode: "冲锋枪", magSize: 24, reserve: 96, damage: 22, headDamage: 40, fireDelay: 50, range: 55, recoil: 0.018, spread: 14 },
    { id: "pistol", name: "P-12", mode: "手枪", magSize: 12, reserve: 48, damage: 28, headDamage: 52, fireDelay: 150, range: 62, recoil: 0.022, spread: 8 }
  ];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const rand = (min, max) => min + Math.random() * (max - min);
  const dist2 = (a, b) => {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
  };

  class Game {
    constructor() {
      this.container = document.getElementById("game");
      this.overlay = document.getElementById("overlay");
      this.startButton = document.getElementById("start-button");
      this.mapPanel = document.getElementById("map-panel");
      this.mapCanvas = document.getElementById("map-canvas");
      this.mapCtx = this.mapCanvas.getContext("2d");
      this.ui = {
        health: document.getElementById("health"),
        armor: document.getElementById("armor"),
        mag: document.getElementById("mag"),
        reserve: document.getElementById("reserve"),
        kills: document.getElementById("kills"),
        zone: document.getElementById("zone"),
        pickup: document.getElementById("pickup"),
        altitude: document.getElementById("altitude"),
        hint: document.getElementById("center-hint"),
        crosshair: document.getElementById("crosshair"),
        hitIndicator: document.getElementById("hit-indicator"),
        healthFill: document.getElementById("health-fill"),
        armorFill: document.getElementById("armor-fill"),
        healthValue: document.getElementById("health-value"),
        armorValue: document.getElementById("armor-value"),
        weaponName: document.getElementById("weapon-name"),
        weaponMode: document.getElementById("weapon-mode"),
        weaponCard: document.getElementById("weapon-card"),
        vignette: document.getElementById("damage-vignette"),
        scope: document.getElementById("scope-overlay"),
        ammoMag: document.getElementById("ammo-mag"),
        ammoReserve: document.getElementById("ammo-reserve"),
        zoneWarning: document.getElementById("zone-warning"),
        remaining: document.getElementById("remaining")
      };

      this.keys = new Set();
      this.mouse = { yaw: 0, pitch: 0 };
      this.mouseButtons = { left: false };
      this.phase = "menu";
      this.running = false;
      this.locked = false;
      this.showMap = false;
      this.clock = new THREE.Clock();
      this.raycaster = new THREE.Raycaster();
      this.forwardVec = new THREE.Vector3();
      this.rightVec = new THREE.Vector3();
      this.lastShot = 0;
      this.recoilKick = 0;
      this.crosshairSpread = 0;
      this.shakeIntensity = 0;
      this.shakeDecay = 0;
      this.aiming = false;
      this.parachuteDeployed = false;
      this.parachuteGroup = null;
      this.roundSeed = Math.random() * 1000;
      this.totalEnemies = TOTAL_ENEMIES;

      this.init();
      this.bindEvents();
      this.animate();
    }

    init() {
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x6fb8d6);
      this.scene.fog = new THREE.Fog(0x7db8c9, 28, 125);

      this.camera = new THREE.PerspectiveCamera(76, window.innerWidth / window.innerHeight, 0.1, 260);
      this.camera.position.set(0, EYE_HEIGHT, 0);

      this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.container.appendChild(this.renderer.domElement);

      this.scene.add(new THREE.HemisphereLight(0xdff8ff, 0x22331e, 0.95));
      const sun = new THREE.DirectionalLight(0xffe4a0, 1.05);
      sun.position.set(18, 42, 20);
      this.scene.add(sun);

      this.textures = this.createTextures();
      this.createWeaponView();
      this.createParachute();
    }

    bindEvents() {
      this.startButton.addEventListener("click", () => this.startRound());
      window.addEventListener("resize", () => this.resize());
      window.addEventListener("keydown", (event) => {
        this.keys.add(event.code);
        if (event.code === "KeyF") this.tryPickup();
        if (event.code === "KeyR") this.reload();
        if (event.code === "KeyM") this.toggleMap();
        if (event.code === "Space") {
          event.preventDefault();
          if (this.phase === "drop") {
            this.parachuteDeployed = true;
            this.parachuteGroup.visible = true;
          } else if (this.phase === "combat") {
            this.jump();
          }
        }
      });
      window.addEventListener("keyup", (event) => this.keys.delete(event.code));
      window.addEventListener("wheel", (event) => {
        if (this.phase !== "combat") return;
        event.preventDefault();
        this.switchWeapon(event.deltaY > 0 ? 1 : -1);
      }, { passive: false });
      document.addEventListener("pointerlockchange", () => {
        this.locked = document.pointerLockElement === this.renderer.domElement;
      });
      document.addEventListener("mousemove", (event) => {
        if (!this.locked || !this.running) return;
        const sens = this.aiming ? 0.4 : 1.0;
        this.mouse.yaw -= event.movementX * 0.0024 * sens;
        this.mouse.pitch = clamp(this.mouse.pitch - event.movementY * 0.0021 * sens, -1.22, 1.22);
      });
      document.addEventListener("mousedown", (event) => {
        if (event.button === 2) {
          if (this.phase === "combat") {
            this.aiming = !this.aiming;
            this.ui.scope.classList.toggle("active", this.aiming);
            this.ui.crosshair.style.opacity = this.aiming ? "0" : "1";
          }
          return;
        }
        if (event.button === 0) {
          this.mouseButtons.left = true;
          if (this.running && !this.locked) {
            this.requestPointerLock();
          }
          if (this.phase === "combat") this.shoot();
        }
      });
      document.addEventListener("mouseup", (event) => {
        if (event.button === 0) {
          this.mouseButtons.left = false;
        }
      });
      document.addEventListener("contextmenu", (e) => e.preventDefault());
    }

    startRound() {
      this.initAudio();
      this.clearRound();
      this.overlay.classList.remove("active");
      this.running = true;
      this.phase = "drop"; // Skip plane phase for now - go straight to drop
      this.gameOver = false;
      this.aiming = false;
      this.shakeIntensity = 0;
      this.parachuteDeployed = false;
      if (this.parachuteGroup) this.parachuteGroup.visible = false;
      this.roundSeed = Math.random() * 1000;
      this.player = {
        health: 5000,
        armor: 0,
        weapons: WEAPON_DEFS.map((weapon) => ({
          ...weapon,
          magAmmo: weapon.magSize,
          reserveAmmo: weapon.reserve
        })),
        activeWeapon: 0,
        kills: 0,
        radius: 0.65,
        isReloading: false,
        reloadTimer: 0,
        dropVelocity: 0,
        verticalVelocity: 0,
        grounded: false,
        crouching: false,
        eyeHeight: EYE_HEIGHT,
        onPlane: false
      };
      const zoneCenter = this.randomLandPoint(0, 18);
      this.zone = {
        center: zoneCenter,
        radius: 140, // 3x larger (was 64)
        nextRadius: 18, // 3x larger (was 18)
        shrinkDelay: 12,
        shrinkTime: 50, // More time to shrink
        elapsed: 0
      };
      this.isRaining = false;
      const drop = this.randomLandPoint(22, 52);
      this.mouse.yaw = rand(-Math.PI, Math.PI);
      this.mouse.pitch = -0.15;
      // Start camera at drop position above ground
      this.camera.position.set(
        drop.x,
        this.getTerrainHeight(drop.x, drop.z) + 80,
        drop.z
      );
      this.obstacles = [];
      this.enemies = [];
      this.pickups = [];
      this.effects = [];
      this.casings = [];
      this.createWorld();
      this.spawnPickups();
      this.spawnEnemies();
      this.requestPointerLock();
      this.playSound("start");
      this.updateHud();
    }

    requestPointerLock() {
      if (!this.renderer.domElement.requestPointerLock) return;
      try {
        const lock = this.renderer.domElement.requestPointerLock();
        if (lock && typeof lock.catch === "function") lock.catch(() => {});
      } catch (error) {
        // Embedded preview browsers may block pointer lock; player can retry with a click.
      }
    }

    clearRound() {
      const keep = new Set([this.camera]);
      for (let i = this.scene.children.length - 1; i >= 0; i -= 1) {
        const child = this.scene.children[i];
        if (child.isLight || keep.has(child)) continue;
        this.scene.remove(child);
      }
      // Clean up rain
      if (this.rainParticles) {
        this.rainParticles = null;
      }
      this.isRaining = false;
      // Reset sky
      this.scene.background = new THREE.Color(0x6fb8d6);
      this.scene.fog = new THREE.Fog(0x7db8c9, 28, 125);
      if (this.weaponGroup) this.camera.add(this.weaponGroup);
      this.zoneWall = null;
    }

    createWorld() {
      const groundGeometry = new THREE.PlaneGeometry(320, 320, 1, 1);
      const ground = new THREE.Mesh(
        groundGeometry,
        new THREE.MeshLambertMaterial({ map: this.textures.ground, flatShading: false })
      );
      ground.rotation.x = -Math.PI / 2;
      this.scene.add(ground);

      const water = new THREE.Mesh(
        new THREE.RingGeometry(WORLD_RADIUS, 125, 96),
        new THREE.MeshBasicMaterial({ color: 0x2b7fa3, transparent: true, opacity: 0.88, side: THREE.DoubleSide })
      );
      water.rotation.x = -Math.PI / 2;
      water.position.y = -0.55;
      this.scene.add(water);

      this.zoneMesh = new THREE.Mesh(
        new THREE.RingGeometry(this.zone.radius - 0.22, this.zone.radius + 0.22, 96),
        new THREE.MeshBasicMaterial({ color: 0x72f2ff, transparent: true, opacity: 0.72, side: THREE.DoubleSide })
      );
      this.zoneMesh.rotation.x = -Math.PI / 2;
      this.zoneMesh.position.set(this.zone.center.x, this.getTerrainHeight(this.zone.center.x, this.zone.center.z) + 0.08, this.zone.center.z);
      this.scene.add(this.zoneMesh);

      // PUBG-style blue zone wall
      this.zoneWall = new THREE.Mesh(
        new THREE.CylinderGeometry(this.zone.radius, this.zone.radius, 100, 96, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0.45, side: THREE.DoubleSide })
      );
      this.zoneWall.position.set(this.zone.center.x, this.getTerrainHeight(this.zone.center.x, this.zone.center.z) + 50, this.zone.center.z);
      this.scene.add(this.zoneWall);

      // Add second cylinder for double the effect
      this.zoneWallInner = new THREE.Mesh(
        new THREE.CylinderGeometry(this.zone.radius - 2, this.zone.radius - 2, 80, 96, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x66aaff, transparent: true, opacity: 0.15, side: THREE.DoubleSide })
      );
      this.zoneWallInner.position.set(this.zone.center.x, this.getTerrainHeight(this.zone.center.x, this.zone.center.z) + 40, this.zone.center.z);
      this.scene.add(this.zoneWallInner);

      // Add clouds
      this.clouds = [];
      for (let i = 0; i < 35; i++) {
        const cloud = new THREE.Mesh(
          new THREE.SphereGeometry(rand(3, 10), 10, 10),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: rand(0.35, 0.65) })
        );
        const pos = this.randomLandPoint(20, 145);
        cloud.position.set(pos.x, rand(35, 70), pos.z);
        this.scene.add(cloud);
        this.clouds.push({ mesh: cloud, speed: rand(0.03, 0.09), angle: rand(0, Math.PI * 2) });
      }

      // Increase tree and building density (with small collision)
      for (let i = 0; i < 300; i += 1) this.addTreePoint(this.randomLandPoint(5, 145), rand(1.0, 2.5));
      for (let i = 0; i < 2000; i += 1) this.addGrassBlade(this.randomLandPoint(3, 145));
      for (let i = 0; i < 40; i += 1) this.addRockPoint(this.randomLandPoint(9, 140), rand(0.5, 1.5));
      for (let i = 0; i < 30; i += 1) this.addCratePoint(this.randomLandPoint(12, 135));
      for (let i = 0; i < 25; i += 1) this.addBarricadePoint(this.randomLandPoint(16, 130));
      for (let i = 0; i < 15; i += 1) this.addWallPoint(this.randomLandPoint(18, 125));
      for (let i = 0; i < 12; i += 1) this.addHutPoint(this.randomLandPoint(24, 120));
    }

    createTextures() {
      const make = (size, draw) => {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = false;
        draw(ctx, size);
        const texture = new THREE.CanvasTexture(canvas);
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        return texture;
      };
      const ground = make(64, (ctx, s) => {
        ctx.fillStyle = "#6e9a49";
        ctx.fillRect(0, 0, s, s);
        for (let i = 0; i < 190; i += 1) {
          ctx.fillStyle = Math.random() > 0.52 ? "#7fb45a" : "#d9c174";
          ctx.fillRect(Math.floor(Math.random() * s), Math.floor(Math.random() * s), 2, 2);
        }
      });
      ground.repeat.set(22, 22);
      const wood = make(64, (ctx, s) => {
        ctx.fillStyle = "#80512d";
        ctx.fillRect(0, 0, s, s);
        for (let y = 0; y < s; y += 10) {
          ctx.fillStyle = y % 20 === 0 ? "#9a6438" : "#6f4325";
          ctx.fillRect(0, y, s, 6);
        }
        ctx.fillStyle = "#2e211a";
        ctx.fillRect(30, 0, 4, s);
        ctx.fillRect(0, 30, s, 4);
      });
      const enemy = make(64, (ctx, s) => {
        ctx.fillStyle = "#2a1a28";
        ctx.fillRect(0, 0, s, s);
        ctx.fillStyle = "#e83838";
        ctx.fillRect(14, 10, 36, 44);
        ctx.fillStyle = "#ffe8c0";
        ctx.fillRect(22, 20, 8, 8);
        ctx.fillRect(36, 20, 8, 8);
        ctx.fillStyle = "#222";
        ctx.fillRect(24, 22, 4, 4);
        ctx.fillRect(38, 22, 4, 4);
        ctx.fillRect(27, 38, 14, 6);
        ctx.fillStyle = "#ff6644";
        ctx.fillRect(14, 54, 36, 6);
      });
      const grass = make(32, (ctx, s) => {
        ctx.fillStyle = "#5a8a3a";
        ctx.fillRect(0, 0, s, s);
        for (let i = 0; i < 420; i += 1) {
          const x = Math.random() * s;
          const y = Math.random() * s;
          const h = 4 + Math.random() * 8;
          ctx.fillStyle = Math.random() > 0.5 ? "#6baa4a" : "#4a7a2a";
          ctx.fillRect(x, y, 1, h);
        }
      });
      return { ground, wood, enemy, grass };
    }

    createWeaponView() {
      this.weaponGroup = new THREE.Group();
      const bodyMat = new THREE.MeshLambertMaterial({ color: 0x2a2a2a });
      const metalMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
      const woodMat = new THREE.MeshLambertMaterial({ color: 0x5a4a32 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.72), bodyMat);
      body.position.set(0.32, -0.34, -0.45);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.12), woodMat);
      grip.position.set(0.28, -0.46, -0.1);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.85, 12), metalMat);
      barrel.position.set(0.32, -0.34, -1.1);
      barrel.rotation.x = Math.PI / 2;
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.28), woodMat);
      stock.position.set(0.32, -0.34, 0.08);
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.25, 10), metalMat);
      scope.position.set(0.32, -0.22, -0.5);
      scope.rotation.x = Math.PI / 2;
      this.muzzle = new THREE.Mesh(
        new THREE.PlaneGeometry(0.12, 0.12),
        new THREE.MeshBasicMaterial({ color: 0xffef7a, transparent: true, opacity: 0, side: THREE.DoubleSide })
      );
      this.muzzle.position.set(0.32, -0.34, -1.55);
      this.weaponGroup.add(body, grip, barrel, stock, scope, this.muzzle);
      this.camera.add(this.weaponGroup);
      this.scene.add(this.camera);
    }

    createParachute() {
      this.parachuteGroup = new THREE.Group();
      const canopyMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.82, side: THREE.DoubleSide });
      const canopy = new THREE.Mesh(new THREE.SphereGeometry(3.2, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), canopyMat);
      canopy.position.y = 5.5;
      this.parachuteGroup.add(canopy);
      const stripeMat = new THREE.MeshLambertMaterial({ color: 0xff4422, transparent: true, opacity: 0.75, side: THREE.DoubleSide });
      const stripe1 = new THREE.Mesh(new THREE.SphereGeometry(3.25, 16, 3, 0, Math.PI * 0.4, 0.2, 0.6), stripeMat);
      stripe1.position.y = 5.5;
      this.parachuteGroup.add(stripe1);
      const stripe2 = new THREE.Mesh(new THREE.SphereGeometry(3.25, 16, 3, Math.PI, Math.PI * 0.4, 0.2, 0.6), stripeMat);
      stripe2.position.y = 5.5;
      this.parachuteGroup.add(stripe2);
      const lineMat = new THREE.MeshBasicMaterial({ color: 0xcccccc });
      for (let i = 0; i < 4; i += 1) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const line = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 5.5, 4), lineMat);
        line.position.set(Math.cos(a) * 2.0, 2.75, Math.sin(a) * 2.0);
        this.parachuteGroup.add(line);
      }
      this.parachuteGroup.visible = false;
      this.camera.add(this.parachuteGroup);
    }

    createRain() {
      this.rainParticles = [];
      const rainMaterial = new THREE.MeshBasicMaterial({ color: 0xaabbff, transparent: true, opacity: 0.6 });
      // Create 1500 raindrops
      for (let i = 0; i < 1500; i += 1) {
        const drop = new THREE.Mesh(
          new THREE.CylinderGeometry(0.02, 0.02, 0.4, 4),
          rainMaterial
        );
        // Position randomly around player
        const angle = rand(0, Math.PI * 2);
        const dist = rand(5, 60);
        drop.position.set(
          this.camera.position.x + Math.cos(angle) * dist,
          this.camera.position.y + rand(10, 40),
          this.camera.position.z + Math.sin(angle) * dist
        );
        drop.rotation.z = 0.3; // Slight angle for wind effect
        this.scene.add(drop);
        this.rainParticles.push(drop);
      }
      // Darken the sky a bit
      this.scene.background = new THREE.Color(0x607080);
      this.scene.fog = new THREE.Fog(0x506070, 28, 125);
    }

    updateRain(delta) {
      const speed = 30;
      for (let i = 0; i < this.rainParticles.length; i += 1) {
        const drop = this.rainParticles[i];
        drop.position.y -= speed * delta;
        drop.position.x -= 5 * delta; // Wind effect
        // If drop is below ground, reset it above player
        if (drop.position.y < this.camera.position.y - 20) {
          const angle = rand(0, Math.PI * 2);
          const dist = rand(5, 60);
          drop.position.set(
            this.camera.position.x + Math.cos(angle) * dist,
            this.camera.position.y + rand(20, 50),
            this.camera.position.z + Math.sin(angle) * dist
          );
        }
      }
    }

    getTerrainHeight(x, z) {
      // Flat terrain - avoid falling through
      return 0;
    }

    randomLandPoint(min, max) {
      for (let i = 0; i < 80; i += 1) {
        const a = rand(0, Math.PI * 2);
        const r = rand(min, max);
        const p = { x: Math.cos(a) * r, z: Math.sin(a) * r };
        if (Math.sqrt(p.x * p.x + p.z * p.z) < WORLD_RADIUS - 5) return p;
      }
      return { x: rand(-35, 35), z: rand(-35, 35) };
    }

    addObstacle(mesh, x, z, radius, height) {
      mesh.position.x = x;
      mesh.position.z = z;
      this.scene.add(mesh);
      this.obstacles.push({ x, z, radius, height: height || 2, mesh });
    }

    addTreePoint(p, scale) {
      const y = this.getTerrainHeight(p.x, p.z);
      const group = new THREE.Group();
      group.position.set(p.x, y, p.z);
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.24 * scale, 0.32 * scale, 3.2 * scale, 8),
        new THREE.MeshLambertMaterial({ color: 0x6b4429 })
      );
      trunk.position.y = 1.6 * scale;
      const top = new THREE.Mesh(new THREE.ConeGeometry(1.4 * scale, 4.2 * scale, 8), new THREE.MeshLambertMaterial({ color: 0x2c6c38 }));
      top.position.y = 4.8 * scale;
      group.add(trunk, top);
      this.addObstacle(group, p.x, p.z, 0.4 * scale, 6.8 * scale); // Smaller collision radius
    }

    addGrassBlade(p) {
      const y = this.getTerrainHeight(p.x, p.z);
      const group = new THREE.Group();
      const blade = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, rand(0.15, 0.4), 0.05),
        new THREE.MeshLambertMaterial({ color: 0x6baa4a })
      );
      blade.position.set(0, blade.scale.y * 0.5, 0);
      group.add(blade);
      group.position.set(p.x, y, p.z);
      group.rotation.y = rand(0, Math.PI * 2);
      this.scene.add(group);
    }

    addRockPoint(p, scale) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.65 * scale, 0), new THREE.MeshLambertMaterial({ color: 0x6f756e }));
      rock.position.y = this.getTerrainHeight(p.x, p.z) + 0.42 * scale;
      rock.rotation.set(rand(0, 1), rand(0, 1), rand(0, 1));
      this.addObstacle(rock, p.x, p.z, 0.4 * scale, 1.3 * scale); // Smaller collision
    }

    addCratePoint(p) {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.45, 1.8), new THREE.MeshLambertMaterial({ map: this.textures.wood }));
      crate.position.y = this.getTerrainHeight(p.x, p.z) + 0.72;
      crate.rotation.y = rand(0, Math.PI);
      this.addObstacle(crate, p.x, p.z, 0.8, 1.45); // Smaller collision
    }

    addBarricadePoint(p) {
      const y = this.getTerrainHeight(p.x, p.z);
      const group = new THREE.Group();
      const mat = new THREE.MeshLambertMaterial({ color: 0x5d4c3a });
      for (let i = 0; i < 3; i += 1) {
        const block = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.8, 0.55), mat);
        block.position.set((i - 1) * 1.05, y + 0.4, rand(-0.12, 0.12));
        block.rotation.y = rand(-0.15, 0.15);
        group.add(block);
      }
      group.rotation.y = rand(0, Math.PI);
      this.addObstacle(group, p.x, p.z, 1.2, 2.4); // Smaller collision
    }

    addWallPoint(p) {
      const y = this.getTerrainHeight(p.x, p.z);
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(rand(3.5, 5.5), 1.7, 0.48),
        new THREE.MeshLambertMaterial({ color: 0x70685b })
      );
      wall.position.y = y + 0.85;
      wall.rotation.y = rand(0, Math.PI);
      this.addObstacle(wall, p.x, p.z, 1.5, 1.7); // Smaller collision
    }

    addHutPoint(p) {
      const y = this.getTerrainHeight(p.x, p.z);
      const group = new THREE.Group();
      const mat = new THREE.MeshLambertMaterial({ color: 0x8f7040 });
      const roofMat = new THREE.MeshLambertMaterial({ color: 0x394732 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(6, 3.2, 5), mat);
      body.position.y = y + 1.6;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(4.3, 1.8, 4), roofMat);
      roof.position.y = y + 4.1;
      roof.rotation.y = Math.PI / 4;
      group.add(body, roof);
      this.addObstacle(group, p.x, p.z, 2.5, 5.9); // Smaller collision
    }

    spawnPickups() {
      const types = [
        "ammo", "med", "armor", "ammo", "med", "ammo", "armor", "ammo", "med", "ammo",
        "ammo", "med", "armor", "ammo", "med", "ammo", "armor", "ammo", "med", "ammo",
        "ammo", "med", "armor", "ammo", "med", "ammo", "armor", "ammo", "med", "ammo",
        "ammo", "med", "armor", "ammo", "med", "ammo", "armor", "ammo", "med", "ammo",
        "ammo", "med", "armor", "ammo", "med", "ammo", "armor", "ammo", "med", "ammo"
      ];
      types.forEach((type) => {
        const p = this.randomLandPoint(8, 58);
        const color = type === "ammo" ? 0xffcf6e : type === "med" ? 0xf2f4ef : type === "armor" ? 0x65d6ff : 0xcccccc;
        const geo = type === "ammo" ? new THREE.BoxGeometry(0.9, 0.32, 0.9) :
                   type === "med" ? new THREE.BoxGeometry(0.6, 0.5, 0.6) :
                   type === "armor" ? new THREE.BoxGeometry(0.7, 0.8, 0.7) : new THREE.BoxGeometry(0.9, 0.32, 0.9);
        const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
        mesh.position.set(p.x, this.getTerrainHeight(p.x, p.z) + 0.16, p.z);
        this.scene.add(mesh);
        this.pickups.push({ type, mesh, x: p.x, z: p.z, radius: 1.1, discovered: true });
      });
    }

    spawnEnemies() {
      for (let i = 0; i < this.totalEnemies; i += 1) {
        const p = this.randomLandPoint(12, 140);
        const group = new THREE.Group();
        // Bigger enemy body for easier hit detection
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.5, 1.0), new THREE.MeshLambertMaterial({ color: 0xc04040, emissive: 0x301010 }));
        body.position.y = 0.95;
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, 0.8), new THREE.MeshLambertMaterial({ map: this.textures.enemy, emissive: 0x181008 }));
        head.position.y = 1.85;
        const rifle = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.9), new THREE.MeshLambertMaterial({ color: 0x2a2a2a }));
        rifle.position.set(0.5, 1.1, -0.38);
        group.add(body, head, rifle);
        const startY = this.getTerrainHeight(p.x, p.z) + 80 + rand(0, 30);
        group.position.set(p.x, startY, p.z);
        this.scene.add(group);
        this.enemies.push({
          mesh: group,
          x: p.x,
          z: p.z,
          y: startY,
          health: 120, // Double health
          radius: 0.75,
          state: "parachuting",
          fireCooldown: rand(0.08, 0.2), // Faster fire rate
          patrolAngle: rand(0, Math.PI * 2),
          dropVelocity: rand(6, 10)
        });
      }
    }

    initAudio() {
      if (this.audioCtx) {
        if (this.audioCtx.state === "suspended") this.audioCtx.resume();
        return;
      }
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.audioCtx = new Ctx();
    }

    playSound(type) {
      if (!this.audioCtx) return;
      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      const spec = {
        shoot: [120, 58, 0.09, 0.22, "square"],
        reload: [360, 180, 0.18, 0.18, "triangle"],
        pickup: [520, 760, 0.11, 0.15, "sine"],
        hurt: [90, 55, 0.22, 0.16, "sawtooth"],
        enemy: [210, 90, 0.08, 0.08, "square"],
        land: [80, 38, 0.24, 0.18, "triangle"],
        win: [520, 920, 0.32, 0.15, "sine"],
        lose: [150, 70, 0.4, 0.15, "sawtooth"],
        start: [420, 260, 0.18, 0.12, "sine"],
        jump: [180, 260, 0.12, 0.08, "triangle"],
        hit: [880, 440, 0.12, 0.16, "sine"],
        headshot: [1320, 660, 0.14, 0.2, "sine"],
        zone: [45, 32, 0.32, 0.05, "sine"],
        click: [320, 320, 0.08, 0.12, "sine"]
      }[type];
      if (!spec) return;
      osc.type = spec[4];
      osc.frequency.setValueAtTime(spec[0], now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, spec[1]), now + spec[2]);
      gain.gain.setValueAtTime(spec[3], now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + spec[2]);
      osc.start(now);
      osc.stop(now + spec[2] + 0.02);
    }

    animate() {
      requestAnimationFrame(() => this.animate());
      const delta = Math.min(this.clock.getDelta(), 0.04);
      if (this.running) this.update(delta);
      this.renderer.render(this.scene, this.camera);
    }

    update(delta) {
      this.zone.elapsed += delta;
      // Check if it should start raining (when half enemies dead)
      const shouldBeRaining = this.enemies.length <= this.totalEnemies / 2;
      if (shouldBeRaining && !this.isRaining) {
        this.isRaining = true;
        this.createRain();
      }
      // Update rain
      if (this.isRaining && this.rainParticles) {
        this.updateRain(delta);
      }
      if (this.phase === "drop") this.updateDrop(delta);
      if (this.phase === "combat") {
        this.updateCamera(delta);
        this.movePlayer(delta);
        this.updateZone(delta);
        this.updateEnemies(delta);
        this.updatePickups(delta);
        this.updateEffects(delta);
        if (this.mouseButtons.left && this.phase === "combat") this.shoot();
        if (this.player.health <= 0) this.finish(false, "你倒在了荒岛上");
        if (this.enemies.length === 0) this.finish(true, "安全区归你了");
      }
      this.updateHud();
      if (this.showMap) this.drawMap();
    }

    updateDrop(delta) {
      this.updateCamera(delta);
      const groundY = this.getTerrainHeight(this.camera.position.x, this.camera.position.z);
      const altitude = this.camera.position.y - groundY;
      if (!this.parachuteDeployed) {
        this.player.dropVelocity = Math.min(55, this.player.dropVelocity + 32 * delta);
        const steer = this.getMoveVector();
        const glideSpeed = 18;
        this.camera.position.x += steer.x * glideSpeed * delta;
        this.camera.position.z += steer.z * glideSpeed * delta;
        if (altitude < 28) {
          this.parachuteDeployed = true;
          this.parachuteGroup.visible = true;
        }
      } else {
        this.player.dropVelocity = 5;
        const steer = this.getMoveVector();
        const glideSpeed = 10;
        this.camera.position.x += steer.x * glideSpeed * delta;
        this.camera.position.z += steer.z * glideSpeed * delta;
        this.mouse.pitch = Math.max(this.mouse.pitch, -0.4);
      }
      const d = Math.sqrt(this.camera.position.x ** 2 + this.camera.position.z ** 2);
      if (d > WORLD_RADIUS - 4) {
        const scale = (WORLD_RADIUS - 4) / d;
        this.camera.position.x *= scale;
        this.camera.position.z *= scale;
      }
      this.camera.position.y -= this.player.dropVelocity * delta;
      if (this.camera.position.y <= groundY + EYE_HEIGHT + 0.1) {
        this.camera.position.y = groundY + EYE_HEIGHT;
        this.player.dropVelocity = 0;
        this.player.eyeHeight = EYE_HEIGHT;
        this.player.grounded = true;
        this.player.verticalVelocity = 0;
        this.parachuteDeployed = false;
        this.parachuteGroup.visible = false;
        this.phase = "combat";
        this.mouse.pitch = 0;
        this.playSound("land");
      }
    }

    updateCamera(delta) {
      this.camera.rotation.order = "YXZ";
      this.camera.rotation.y = this.mouse.yaw;
      this.camera.rotation.x = this.mouse.pitch;
      const targetFov = this.aiming ? 38 : 76;
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, (delta || 0.016) * 10);
      this.camera.updateProjectionMatrix();
      if (this.shakeIntensity > 0.001) {
        this.camera.position.x += (Math.random() - 0.5) * this.shakeIntensity;
        this.camera.position.z += (Math.random() - 0.5) * this.shakeIntensity;
      }
    }

    getMoveVector() {
      this.camera.getWorldDirection(this.forwardVec);
      this.forwardVec.y = 0;
      if (this.forwardVec.lengthSq() < 0.0001) this.forwardVec.set(Math.sin(this.mouse.yaw), 0, -Math.cos(this.mouse.yaw));
      this.forwardVec.normalize();
      this.rightVec.crossVectors(this.forwardVec, this.camera.up).normalize();
      const move = new THREE.Vector3();
      if (this.keys.has("KeyW")) move.add(this.forwardVec);
      if (this.keys.has("KeyS")) move.sub(this.forwardVec);
      if (this.keys.has("KeyD")) move.add(this.rightVec);
      if (this.keys.has("KeyA")) move.sub(this.rightVec);
      if (move.lengthSq() > 0) move.normalize();
      return move;
    }

    movePlayer(delta) {
      this.player.crouching = this.keys.has("ControlLeft") || this.keys.has("ControlRight");
      this.player.eyeHeight += (this.currentEyeHeight() - this.player.eyeHeight) * Math.min(1, delta * 12);
      const move = this.getMoveVector();
      const baseSpeed = this.player.crouching ? 2.8 : this.aiming ? 3.2 : 5.1;
      const speed = (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight")) && !this.player.crouching && !this.aiming ? 8.1 : baseSpeed;
      const next = {
        x: this.camera.position.x + move.x * speed * delta,
        z: this.camera.position.z + move.z * speed * delta
      };
      const currentGround = this.getTerrainHeight(this.camera.position.x, this.camera.position.z);
      const nextGround = this.getTerrainHeight(next.x, next.z);
      if (move.lengthSq() > 0 && this.canMoveTo(next, nextGround, currentGround)) {
        this.camera.position.x = next.x;
        this.camera.position.z = next.z;
      }
      this.applyVerticalMotion(delta);
    }

    canMoveTo(next, nextGround, currentGround) {
      const d = Math.sqrt(next.x * next.x + next.z * next.z);
      if (d > WORLD_RADIUS - 1.5) return false;
      // Simplified obstacle check - more lenient
      for (const obstacle of this.obstacles) {
        if (dist2(next, obstacle) < 0.3) { // Only block if very close
          return false;
        }
      }
      if (this.player.grounded && nextGround > currentGround + 1.8) return false;
      if (nextGround < -1.0) return false;
      return true;
    }

    currentEyeHeight() {
      return this.player.crouching ? 1.05 : EYE_HEIGHT;
    }

    applyVerticalMotion(delta) {
      const groundY = this.getTerrainHeight(this.camera.position.x, this.camera.position.z);
      const targetGroundY = groundY + this.player.eyeHeight;
      if (!this.player.grounded) {
        this.player.verticalVelocity -= 18 * delta;
      }
      this.camera.position.y += this.player.verticalVelocity * delta;
      // Make sure we don't fall through the ground
      if (this.camera.position.y <= targetGroundY) {
        this.camera.position.y = targetGroundY;
        this.player.verticalVelocity = 0;
        this.player.grounded = true;
      } else {
        // Only consider grounded if we're very close to the ground
        this.player.grounded = this.camera.position.y < targetGroundY + 0.5 && this.player.verticalVelocity <= 0;
      }
    }

    jump() {
      if (this.phase !== "combat" || !this.player.grounded || this.player.crouching) return;
      this.player.verticalVelocity = 7.2;
      this.player.grounded = false;
      this.playSound("jump");
    }

    updateZone(delta) {
      if (this.zone.elapsed > this.zone.shrinkDelay) {
        const t = clamp((this.zone.elapsed - this.zone.shrinkDelay) / this.zone.shrinkTime, 0, 1);
        this.zone.radius = 64 + (this.zone.nextRadius - 64) * t;
      }
      if (this.zoneMesh) {
        this.zoneMesh.geometry.dispose();
        this.zoneMesh.geometry = new THREE.RingGeometry(this.zone.radius - 0.22, this.zone.radius + 0.22, 96);
      }
      if (this.zoneWall) {
        this.zoneWall.geometry.dispose();
        this.zoneWall.geometry = new THREE.CylinderGeometry(this.zone.radius, this.zone.radius, 100, 96, 1, true);
        this.zoneWall.position.set(this.zone.center.x, this.getTerrainHeight(this.zone.center.x, this.zone.center.z) + 50, this.zone.center.z);
      }
      if (this.zoneWallInner) {
        this.zoneWallInner.geometry.dispose();
        this.zoneWallInner.geometry = new THREE.CylinderGeometry(this.zone.radius - 2, this.zone.radius - 2, 80, 96, 1, true);
        this.zoneWallInner.position.set(this.zone.center.x, this.getTerrainHeight(this.zone.center.x, this.zone.center.z) + 40, this.zone.center.z);
      }
      const playerDistance = dist2({ x: this.camera.position.x, z: this.camera.position.z }, this.zone.center);
      if (playerDistance > this.zone.radius) {
        this.damagePlayer(15 * delta, this.zone.center, "zone");
      }
    }

    updateEnemies(delta) {
      const playerPos = { x: this.camera.position.x, z: this.camera.position.z };
      for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
        const enemy = this.enemies[i];
        if (enemy.state === "parachuting") {
          const groundY = this.getTerrainHeight(enemy.x, enemy.z);
          enemy.y -= enemy.dropVelocity * delta;
          if (enemy.y <= groundY) {
            enemy.state = "patrol";
            enemy.y = groundY;
          }
          enemy.mesh.position.set(enemy.x, enemy.y, enemy.z);
          continue;
        }
        const d = dist2(enemy, playerPos);
        const seesPlayer = (d < 24 || enemy.state === "attack");
        const zoneDistance = dist2(enemy, this.zone.center);
        const outsideZone = zoneDistance > this.zone.radius - 1.2;
        let target = null;
        let targetDistance = Infinity;
        let targetIsPlayer = false;
        // Find nearest target (player or enemy)
        if (seesPlayer) {
          target = playerPos;
          targetDistance = d;
          targetIsPlayer = true;
        }
        // Also look for other enemies to fight
        for (const other of this.enemies) {
          if (other === enemy) continue;
          const otherDist = dist2(enemy, other);
          if (otherDist < 22 && otherDist < targetDistance) {
            target = other;
            targetDistance = otherDist;
            targetIsPlayer = false;
          }
        }
        if (outsideZone) {
          enemy.health -= 9 * delta;
          if (enemy.health <= 0) {
            this.removeEnemy(enemy, false);
            continue;
          }
          enemy.state = "fleeZone";
        } else if (target) {
          enemy.state = enemy.health < 34 ? "cover" : "attack";
        }
        let dx = 0;
        let dz = 0;
        if (enemy.state === "fleeZone") {
          dx = this.zone.center.x - enemy.x;
          dz = this.zone.center.z - enemy.z;
        } else if (enemy.state === "cover") {
          const coverTarget = target || playerPos;
          const cover = this.findCoverPoint(enemy, coverTarget);
          if (cover) {
            dx = cover.x - enemy.x;
            dz = cover.z - enemy.z;
            if (Math.sqrt(dx * dx + dz * dz) < 1.4) enemy.state = "attack";
          } else {
            enemy.state = "attack";
            const atkTarget = target || playerPos;
            dx = atkTarget.x - enemy.x;
            dz = atkTarget.z - enemy.z;
          }
        } else if (enemy.state === "attack" && target) {
          dx = target.x - enemy.x;
          dz = target.z - enemy.z;
        } else {
          enemy.patrolAngle += Math.sin(performance.now() * 0.0002 + enemy.x) * delta;
          dx = Math.cos(enemy.patrolAngle);
          dz = Math.sin(enemy.patrolAngle);
        }
        const len = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
        dx /= len;
        dz /= len;
        const speed = enemy.state === "fleeZone" ? 3.0 : enemy.state === "attack" ? 2.25 : enemy.state === "cover" ? 2.5 : 0.9;
        if (targetDistance > 5 || enemy.state === "patrol" || enemy.state === "fleeZone" || enemy.state === "cover") {
          const next = { x: enemy.x + dx * speed * delta, z: enemy.z + dz * speed * delta };
          if (Math.sqrt(next.x * next.x + next.z * next.z) < WORLD_RADIUS - 4 && !this.blocksEnemy(next, enemy)) {
            let blocked = false;
            for (const other of this.enemies) {
              if (other === enemy) continue;
              if (dist2(next, other) < enemy.radius + other.radius) { blocked = true; break; }
            }
            if (!blocked) {
              enemy.x = next.x;
              enemy.z = next.z;
              enemy.mesh.position.x = next.x;
              enemy.mesh.position.z = next.z;
              enemy.mesh.position.y = this.getTerrainHeight(next.x, next.z);
            }
          }
        }
        enemy.mesh.rotation.y = Math.atan2(dx, dz);
        enemy.fireCooldown -= delta;
        if (enemy.state === "attack" && !outsideZone && target && targetDistance < 24 && enemy.fireCooldown <= 0) {
          enemy.fireCooldown = rand(0.08, 0.2); // FAST fire rate!
          if (targetIsPlayer) {
            this.enemyShoot(enemy, targetDistance);
          } else {
            this.enemyShootEnemy(enemy, target, targetDistance);
          }
        }
      }
    }

    findCoverPoint(enemy, playerPos) {
      let best = null;
      let bestScore = Infinity;
      for (const obstacle of this.obstacles) {
        const obstacleDistance = dist2(enemy, obstacle);
        if (obstacleDistance > 22 || obstacle.radius < 1.2) continue;
        const awayX = obstacle.x - playerPos.x;
        const awayZ = obstacle.z - playerPos.z;
        const len = Math.max(0.001, Math.sqrt(awayX * awayX + awayZ * awayZ));
        const point = {
          x: obstacle.x + (awayX / len) * (obstacle.radius + 1.2),
          z: obstacle.z + (awayZ / len) * (obstacle.radius + 1.2)
        };
        if (Math.sqrt(point.x * point.x + point.z * point.z) > WORLD_RADIUS - 5) continue;
        if (dist2(point, this.zone.center) > this.zone.radius - 2) continue;
        const score = obstacleDistance + dist2(point, playerPos) * 0.15;
        if (score < bestScore) {
          bestScore = score;
          best = point;
        }
      }
      return best;
    }

    blocksEnemy(next, enemy) {
      for (const obstacle of this.obstacles) {
        if (dist2(next, obstacle) < enemy.radius + obstacle.radius) return true;
      }
      return false;
    }

    updatePickups(delta) {
      let nearest = null;
      let nearestDistance = Infinity;
      for (const pickup of this.pickups) {
        pickup.mesh.rotation.y += delta * 0.8;
        pickup.mesh.position.y = this.getTerrainHeight(pickup.x, pickup.z) + 0.16;
        const d = dist2({ x: this.camera.position.x, z: this.camera.position.z }, pickup);
        if (d < nearestDistance) {
          nearestDistance = d;
          nearest = pickup;
        }
      }
      this.nearPickup = nearestDistance < 2.1 ? nearest : null;
    }

    tryPickup() {
      if (this.phase !== "combat" || !this.nearPickup) return;
      const pickup = this.nearPickup;
      if (pickup.type === "ammo") {
        for (const weapon of this.player.weapons) weapon.reserveAmmo += Math.ceil(weapon.magSize * 0.8);
      }
      if (pickup.type === "med") this.player.health = clamp(this.player.health + 35, 0, 5000);
      if (pickup.type === "armor") this.player.armor = clamp(this.player.armor + 35, 0, 80);
      this.scene.remove(pickup.mesh);
      this.pickups = this.pickups.filter((item) => item !== pickup);
      this.nearPickup = null;
      this.playSound("pickup");
      this.updateHud();
    }

    currentWeapon() {
      return this.player.weapons[this.player.activeWeapon];
    }

    switchWeapon(direction) {
      if (this.player.isReloading) return;
      this.aiming = false;
      this.ui.scope.classList.remove("active");
      this.ui.crosshair.style.opacity = "1";
      const count = this.player.weapons.length;
      this.player.activeWeapon = (this.player.activeWeapon + direction + count) % count;
      this.weaponGroup.position.set(0, -0.04, 0.08);
      this.crosshairSpread = 12;
      this.updateHud();
    }

    reload() {
      if (this.phase !== "combat" || this.player.isReloading) return;
      const weapon = this.currentWeapon();
      if (weapon.magAmmo >= weapon.magSize || weapon.reserveAmmo <= 0) return;
      this.player.isReloading = true;
      this.player.reloadTimer = 0;
      this.ui.weaponCard.classList.add("reload-anim");
      this.playSound("reload");
      this.weaponGroup.position.set(0.08, -0.12, 0.12);
      this.weaponGroup.rotation.set(-0.15, 0.12, 0);
      window.setTimeout(() => {
        if (!this.player || !this.player.isReloading) return;
        const active = this.currentWeapon();
        const need = active.magSize - active.magAmmo;
        const moved = Math.min(need, active.reserveAmmo);
        active.magAmmo += moved;
        active.reserveAmmo -= moved;
        this.player.isReloading = false;
        this.player.reloadTimer = 0;
        this.ui.weaponCard.classList.remove("reload-anim");
        this.weaponGroup.position.set(0, -0.04, 0.08);
        this.weaponGroup.rotation.set(0, 0, 0);
        this.updateHud();
      }, 900);
    }

    shoot() {
      const now = performance.now();
      const weapon = this.currentWeapon();
      if (this.player.isReloading || now - this.lastShot < weapon.fireDelay) return;
      if (weapon.magAmmo <= 0) {
        this.reload();
        return;
      }
      this.lastShot = now;
      weapon.magAmmo -= 1;
      this.muzzle.material.opacity = 1;
      this.weaponGroup.position.z = 0.08;
      this.recoilKick += weapon.recoil * (this.aiming ? 0.5 : 1);
      this.crosshairSpread = Math.min(34, this.crosshairSpread + weapon.spread * (this.aiming ? 0.3 : 1));
      this.spawnCasing();
      this.playSound("shoot");

      this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
      // First check for enemy hits
      const enemyHits = [];
      for (const enemy of this.enemies) {
        enemy.mesh.traverse((part) => {
          if (part.isMesh) enemyHits.push({ part, enemy });
        });
      }
      const enemyIntersections = this.raycaster.intersectObjects(enemyHits.map((item) => item.part), false);
      let closestHit = null;
      let closestDistance = weapon.range;
      if (enemyIntersections.length && enemyIntersections[0].distance < closestDistance) {
        closestDistance = enemyIntersections[0].distance;
        const hitPart = enemyIntersections[0].object;
        const target = enemyHits.find((item) => item.part === hitPart);
        if (target) {
          const isHead = hitPart.position.y > 1.5;
          const dmg = isHead ? weapon.headDamage : weapon.damage;
          target.enemy.health -= dmg;
          target.enemy.state = "attack";
          this.spawnHitSpark(enemyIntersections[0].point);
          this.spawnDamageNumber(enemyIntersections[0].point, dmg, isHead);
          this.shakeIntensity = Math.max(this.shakeIntensity, isHead ? 0.18 : 0.08);
          this.shakeDecay = 14;
          this.playSound(isHead ? "headshot" : "hit");
          if (target.enemy.health <= 0) this.killEnemy(target.enemy);
          return; // Hit enemy, don't need to check ground
        }
      }
      // If no enemy hit, check ground/obstacles for dust effect
      const groundObjs = [];
      this.scene.traverse((obj) => {
        if (obj.isMesh && obj !== this.muzzle) groundObjs.push(obj);
      });
      const groundIntersections = this.raycaster.intersectObjects(groundObjs, false);
      if (groundIntersections.length && groundIntersections[0].distance <= weapon.range) {
        this.spawnHitSpark(groundIntersections[0].point, true);
      }
    }

    killEnemy(enemy) {
      this.removeEnemy(enemy, true);
      this.player.kills += 1;
      const dropType = Math.random() > 0.45 ? "ammo" : "med";
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.85, 0.3, 0.85),
        new THREE.MeshLambertMaterial({ color: dropType === "ammo" ? 0xffcf6e : 0xf2f4ef })
      );
      mesh.position.set(enemy.x, this.getTerrainHeight(enemy.x, enemy.z) + 0.16, enemy.z);
      this.scene.add(mesh);
      this.pickups.push({ type: dropType, mesh, x: enemy.x, z: enemy.z, radius: 1.1, discovered: true });
    }

    removeEnemy(enemy, withLoot=false) {
      this.scene.remove(enemy.mesh);
      this.enemies = this.enemies.filter((item) => item !== enemy);
    }

    enemyShoot(enemy, distance) {
      const hitChance = clamp(0.75 - distance * 0.01, 0.3, 0.65); // Higher hit chance
      this.spawnTracer(new THREE.Vector3(enemy.x, this.getTerrainHeight(enemy.x, enemy.z) + 1.25, enemy.z), this.camera.position);
      this.playSound("enemy");
      if (Math.random() < hitChance) this.damagePlayer(rand(12, 22), enemy); // Much more damage
    }

    enemyShootEnemy(shooter, target, distance) {
      const hitChance = clamp(0.58 - distance * 0.012, 0.15, 0.5);
      const targetY = this.getTerrainHeight(target.x, target.z);
      this.spawnTracer(
        new THREE.Vector3(shooter.x, this.getTerrainHeight(shooter.x, shooter.z) + 1.25, shooter.z),
        new THREE.Vector3(target.x, targetY + 1.1, target.z)
      );
      if (Math.random() < hitChance) {
        target.health -= rand(7, 12);
        target.state = "attack";
        // Make sure attacked enemy targets back
        target.patrolAngle = Math.atan2(shooter.x - target.x, shooter.z - target.z);
        if (target.health <= 0) {
          this.removeEnemy(target, true);
          // Drop loot
          const dropType = Math.random() > 0.45 ? "ammo" : "med";
          const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(0.85, 0.3, 0.85),
            new THREE.MeshLambertMaterial({ color: dropType === "ammo" ? 0xffcf6e : 0xf2f4ef })
          );
          mesh.position.set(target.x, this.getTerrainHeight(target.x, target.z) + 0.16, target.z);
          this.scene.add(mesh);
          this.pickups.push({ type: dropType, mesh, x: target.x, z: target.z, radius: 1.1, discovered: true });
        }
      }
    }

    damagePlayer(amount, source, sound="hurt") {
      let remaining = amount;
      if (this.player.armor > 0) {
        const absorbed = Math.min(this.player.armor, remaining * 0.68);
        this.player.armor -= absorbed;
        remaining -= absorbed;
      }
      this.player.health = clamp(this.player.health - remaining, 0, 5000);
      if (source && sound==="hurt") this.showHitDirection(source);
      if (sound==="hurt") {
        this.shakeIntensity = Math.max(this.shakeIntensity, 0.12);
        this.shakeDecay = 12;
      }
      this.playSound(sound);
      this.ui.vignette.classList.add("hit");
      window.clearTimeout(this.flashTimer);
      this.flashTimer = window.setTimeout(() => this.ui.vignette.classList.remove("hit"), 90);
    }

    showHitDirection(source) {
      const dx = source.x - this.camera.position.x;
      const dz = source.z - this.camera.position.z;
      const worldAngle = Math.atan2(dx, dz);
      const relative = worldAngle - this.mouse.yaw;
      this.ui.hitIndicator.style.setProperty("--hit-angle", `${relative}rad`);
      this.ui.hitIndicator.classList.add("active");
      window.clearTimeout(this.hitTimer);
      this.hitTimer = window.setTimeout(() => this.ui.hitIndicator.classList.remove("active"), 520);
    }

    spawnHitSpark(point, isGroundHit = false) {
      if (isGroundHit) {
        // Ground hit - dust
        const dustColors = [0x8b7355, 0x9c8b75, 0xa08b70];
        for (let i = 0; i < 12; i += 1) {
          const dust = new THREE.Mesh(
            new THREE.SphereGeometry(0.05 + Math.random() * 0.07, 4, 4),
            new THREE.MeshBasicMaterial({ color: dustColors[i % dustColors.length], transparent: true, opacity: 0.8 })
          );
          const angle = Math.random() * Math.PI * 2;
          const speed = 0.5 + Math.random() * 1.5;
          dust.position.copy(point);
          dust.userData = {
            vel: new THREE.Vector3(
              Math.cos(angle) * speed,
              0.5 + Math.random() * 1.5,
              Math.sin(angle) * speed
            )
          };
          this.scene.add(dust);
          this.effects.push({ mesh: dust, life: 0.4 + Math.random() * 0.3, isDust: true });
        }
        // Small ground spark
        const flash = new THREE.Mesh(
          new THREE.SphereGeometry(0.15, 6, 6),
          new THREE.MeshBasicMaterial({ color: 0xffcc44, transparent: true, opacity: 0.4 })
        );
        flash.position.copy(point);
        this.scene.add(flash);
        this.effects.push({ mesh: flash, life: 0.05 });
      } else {
        // Enemy hit - blood!
        const bloodColors = [0xdd3333, 0xcc2222, 0xbb1111];
        for (let i = 0; i < 20; i += 1) {
          const blood = new THREE.Mesh(
            new THREE.SphereGeometry(0.04 + Math.random() * 0.06, 4, 4),
            new THREE.MeshBasicMaterial({ color: bloodColors[i % bloodColors.length], transparent: true, opacity: 0.9 })
          );
          const angle = Math.random() * Math.PI * 2;
          const speed = 1 + Math.random() * 3;
          blood.position.copy(point);
          blood.userData = {
            vel: new THREE.Vector3(
              Math.cos(angle) * speed,
              1 + Math.random() * 2.5,
              Math.sin(angle) * speed
            )
          };
          this.scene.add(blood);
          this.effects.push({ mesh: blood, life: 0.5 + Math.random() * 0.4, isDust: true });
        }
        // Big blood splash flash
        const flash = new THREE.Mesh(
          new THREE.SphereGeometry(0.35, 6, 6),
          new THREE.MeshBasicMaterial({ color: 0xff3333, transparent: true, opacity: 0.6 })
        );
        flash.position.copy(point);
        this.scene.add(flash);
        this.effects.push({ mesh: flash, life: 0.08 });
      }
    }

    spawnDamageNumber(point, damage, isHead) {
      const el = document.createElement("div");
      el.className = "damage-number" + (isHead ? " headshot" : "");
      el.textContent = isHead ? damage + " 爆头!" : damage;
      document.getElementById("hud").appendChild(el);
      const v = point.clone().project(this.camera);
      const x = (v.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
      el.style.left = x + "px";
      el.style.top = y + "px";
      window.setTimeout(() => el.remove(), 800);
    }

    spawnTracer(from, to) {
      const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xff624f, transparent: true, opacity: 0.7 }));
      this.scene.add(line);
      this.effects.push({ mesh: line, life: 0.09 });
    }

    spawnCasing() {
      const casing = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.025, 0.12, 8),
        new THREE.MeshLambertMaterial({ color: 0xb89536 })
      );
      const dir = new THREE.Vector3();
      const right = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      right.crossVectors(dir, this.camera.up).normalize();
      casing.position.copy(this.camera.position)
        .add(dir.multiplyScalar(0.75))
        .add(right.multiplyScalar(0.34))
        .add(new THREE.Vector3(0, -0.25, 0));
      casing.rotation.set(rand(-0.5, 0.5), rand(0, Math.PI * 2), rand(-0.5, 0.5));
      this.scene.add(casing);
      this.casings.push({
        mesh: casing,
        life: 1.2,
        velocity: right.multiplyScalar(4.2).add(new THREE.Vector3(0, 1.9, 0)),
        rotationVelocity: new THREE.Vector3(rand(-8, 8), rand(-8, 8), rand(-8, 8))
      });
    }

    updateEffects(delta) {
      if (this.shakeIntensity > 0) {
        this.shakeIntensity *= Math.max(0, 1 - delta * this.shakeDecay);
        if (this.shakeIntensity < 0.001) this.shakeIntensity = 0;
      }
      if (this.recoilKick > 0) {
        const kick = Math.min(this.recoilKick, delta * 3.2);
        this.mouse.pitch = clamp(this.mouse.pitch + kick, -1.22, 1.22);
        this.recoilKick -= kick;
      }
      this.crosshairSpread = Math.max(0, this.crosshairSpread - delta * 30);
      this.ui.crosshair.style.setProperty("--spread", `${this.crosshairSpread}px`);
      this.muzzle.material.opacity = Math.max(0, this.muzzle.material.opacity - delta * 12);
      const targetY = this.player && this.player.crouching ? 0.08 : 0;
      this.weaponGroup.position.y += (targetY - this.weaponGroup.position.y) * Math.min(1, delta * 10);
      this.weaponGroup.position.z += (0 - this.weaponGroup.position.z) * Math.min(1, delta * 12);
      for (let i = this.casings.length - 1; i >= 0; i -= 1) {
        const casing = this.casings[i];
        casing.life -= delta;
        casing.velocity.y -= 7 * delta;
        casing.mesh.position.addScaledVector(casing.velocity, delta);
        if (casing.rotationVelocity) {
          casing.mesh.rotation.x += casing.rotationVelocity.x * delta;
          casing.mesh.rotation.y += casing.rotationVelocity.y * delta;
          casing.mesh.rotation.z += casing.rotationVelocity.z * delta;
        } else {
          casing.mesh.rotation.x += delta * 12;
          casing.mesh.rotation.z += delta * 9;
        }
        if (casing.life <= 0) {
          this.scene.remove(casing.mesh);
          this.casings.splice(i, 1);
        }
      }
      for (let i = this.effects.length - 1; i >= 0; i -= 1) {
        const effect = this.effects[i];
        effect.life -= delta;
        // Update dust particles
        if (effect.isDust && effect.mesh.userData && effect.mesh.userData.vel) {
          effect.mesh.userData.vel.y -= 3 * delta;
          effect.mesh.position.addScaledVector(effect.mesh.userData.vel, delta);
          effect.mesh.material.opacity = effect.life / 0.5;
        }
        if (effect.life <= 0) {
          this.scene.remove(effect.mesh);
          this.effects.splice(i, 1);
        }
      }
    }

    toggleMap() {
      this.showMap = !this.showMap;
      this.mapPanel.classList.toggle("active", this.showMap);
      if (this.showMap) this.drawMap();
    }

    drawMap() {
      const ctx = this.mapCtx;
      const size = this.mapCanvas.width;
      const center = size / 2;
      const scale = (size - 28) / (WORLD_RADIUS * 2);
      const toMap = (x, z) => ({ x: center + x * scale, y: center + z * scale });
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = "#173545";
      ctx.fillRect(0, 0, size, size);
      ctx.beginPath();
      ctx.arc(center, center, WORLD_RADIUS * scale, 0, Math.PI * 2);
      ctx.fillStyle = "#4d8d4a";
      ctx.fill();
      ctx.strokeStyle = "#d7c477";
      ctx.lineWidth = 2;
      ctx.stroke();

      const zonePoint = toMap(this.zone.center.x, this.zone.center.z);
      ctx.beginPath();
      ctx.arc(zonePoint.x, zonePoint.y, this.zone.radius * scale, 0, Math.PI * 2);
      ctx.strokeStyle = "#78f0ff";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(zonePoint.x, zonePoint.y, this.zone.nextRadius * scale, 0, Math.PI * 2);
      ctx.strokeStyle = "#ffffff";
      ctx.setLineDash([4, 5]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "#ffcf6e";
      for (const pickup of this.pickups) {
        const p = toMap(pickup.x, pickup.z);
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      }
      ctx.fillStyle = "#e54a49";
      for (const enemy of this.enemies) {
        const p = toMap(enemy.x, enemy.z);
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      }

      const player = toMap(this.camera.position.x, this.camera.position.z);
      ctx.save();
      ctx.translate(player.x, player.y);
      ctx.rotate(-this.mouse.yaw);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(5, 6);
      ctx.lineTo(0, 3);
      ctx.lineTo(-5, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    updateHud() {
      if (!this.player) return;
      const weapon = this.currentWeapon();
      const remainingAlive = 1 + this.enemies.length;
      this.ui.health.textContent = Math.ceil(this.player.health);
      this.ui.armor.textContent = Math.ceil(this.player.armor);
      this.ui.healthValue.textContent = Math.ceil(this.player.health);
      this.ui.armorValue.textContent = Math.ceil(this.player.armor);
      this.ui.healthFill.style.transform = `scaleX(${clamp(this.player.health / 5000, 0, 1)})`;
      this.ui.armorFill.style.transform = `scaleX(${clamp(this.player.armor / 80, 0, 1)})`;
      this.ui.mag.textContent = this.player.isReloading ? "换弹" : weapon.magAmmo;
      this.ui.reserve.textContent = weapon.reserveAmmo;
      this.ui.weaponName.textContent = weapon.name;
      this.ui.weaponMode.textContent = weapon.mode;
      this.ui.ammoMag.textContent = weapon.magAmmo;
      this.ui.ammoReserve.textContent = weapon.reserveAmmo;
      this.ui.kills.textContent = `${this.player.kills} / ${this.totalEnemies}`;
      this.ui.remaining.textContent = remainingAlive;
      this.ui.altitude.parentElement.style.display = this.phase === "drop" ? "block" : "none";
      this.ui.hint.style.display = "block";
      if (this.phase === "drop") {
        const groundY = this.getTerrainHeight(this.camera.position.x, this.camera.position.z) + EYE_HEIGHT;
        const alt = Math.max(0, Math.ceil(this.camera.position.y - groundY));
        this.ui.altitude.textContent = `${alt}m`;
        this.ui.hint.textContent = this.parachuteDeployed
          ? `开伞滑翔 ${alt}m — WASD 控制方向 — 剩余 ${remainingAlive}人`
          : `自由落体 ${alt}m — 空格开伞 · WASD 调整落点 — 剩余 ${remainingAlive}人`;
      } else if (this.phase === "combat") {
        this.ui.hint.style.display = "none";
      }
      const playerDistance = dist2({ x: this.camera.position.x, z: this.camera.position.z }, this.zone.center);
      const zoneGap = Math.ceil(this.zone.radius - playerDistance);
      const isOutsideZone = zoneGap < 0;
      this.ui.zone.textContent = zoneGap >= 0 ? `${zoneGap}m` : `圈外 ${Math.abs(zoneGap)}m`;
      this.ui.zone.parentElement.classList.toggle("danger", isOutsideZone);
      this.ui.zoneWarning.classList.toggle("active", isOutsideZone);
      this.ui.mag.parentElement.classList.toggle("warning", weapon.magAmmo <= Math.ceil(weapon.magSize * 0.25));
      if (!this.nearPickup) {
        this.ui.pickup.textContent = "无";
        this.ui.pickup.parentElement.classList.remove("warning");
      } else {
        const names = { ammo: "弹药 F", med: "医疗 F", armor: "护甲 F" };
        this.ui.pickup.textContent = names[this.nearPickup.type];
        this.ui.pickup.parentElement.classList.add("warning");
      }
    }

    finish(victory, message) {
      if (this.gameOver) return;
      this.gameOver = true;
      this.running = false;
      this.phase = "ended";
      this.aiming = false;
      this.ui.scope.classList.remove("active");
      this.ui.crosshair.style.opacity = "1";
      if (document.pointerLockElement) document.exitPointerLock();
      this.overlay.classList.add("active");
      this.overlay.querySelector(".eyebrow").textContent = victory ? "胜利结算" : "行动失败";
      this.overlay.querySelector("h1").textContent = victory ? "大吉大利" : "任务结束";
      this.overlay.querySelector(".lede").textContent = `${message}。击杀 ${this.player.kills} / ${this.totalEnemies}，点击按钮重新跳伞。`;
      this.startButton.textContent = "重新跳伞";
      this.playSound(victory ? "win" : "lose");
    }

    resize() {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
  }

  window.addEventListener("load", () => {
    if (!window.THREE) {
      document.getElementById("overlay").querySelector(".lede").textContent = "Three.js 未加载，检查 assets/vendor/three.min.js 是否存在。";
      return;
    }
    new Game();
  });
})();
