/**
 * 🍰 Kawaii Bakery — VR Support (v2 — Quest 3 direct WebXR)
 * vr.js
 *
 * Bypasses A-Frame's controller-detection pipeline (laser-controls →
 * hand-controls → oculus-touch-controls) which can fail on Quest 3 because
 * the "Meta Quest Touch Plus" profile string isn't in A-Frame 1.5.0's
 * allowlist.
 *
 * Instead, `quest-controller` directly polls XRInputSources each frame:
 *  • Updates entity pose from targetRaySpace (correct pointing direction).
 *  • Reads thumbstick axes and emits 'thumbstickmoved'.
 *  • Reads grip/trigger buttons and emits gripdown/gripup/triggerdown/triggerup.
 *  • On triggerdown fires 'click' on the first raycaster intersection (replaces
 *    the cursor behaviour that laser-controls provided).
 *  • Draws a visible laser line.
 *
 * The existing thumbstick-locomotion, snap-turn, and vr-grab components listen
 * for the same events as before — no changes needed there.
 */

/* ─────────────────────────────────────────────
 * QUEST-CONTROLLER — Direct WebXR input polling
 * ───────────────────────────────────────────── */
AFRAME.registerComponent('quest-controller', {
  schema: {
    hand:      { type: 'string', default: 'left' },
    lineColor: { type: 'color',  default: '#ff6eb0' },
  },

  init: function () {
    this.inputSource = null;

    // Button state tracking (to emit press/release edges)
    this.gripPressed    = false;
    this.triggerPressed = false;

    // Thumbstick state for change detection
    this.lastX = 0;
    this.lastY = 0;

    // Visual: controller pointer (small sphere) + laser line
    this.el.setAttribute('visible', false); // hidden until XR connects

    // Pointer ball
    const ball = document.createElement('a-sphere');
    ball.setAttribute('radius', '0.015');
    ball.setAttribute('material', 'color: ' + this.data.lineColor + '; shader: flat');
    ball.classList.add('controller-visual');
    this.el.appendChild(ball);

    // Laser line (drawn via THREE.Line for efficiency)
    const lineMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(this.data.lineColor),
      transparent: true,
      opacity: 0.75,
    });
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -6),
    ]);
    this._line = new THREE.Line(lineGeo, lineMat);
    this.el.object3D.add(this._line);
  },

  tick: function () {
    const scene  = this.el.sceneEl;
    const renderer = scene.renderer;
    if (!renderer || !renderer.xr || !renderer.xr.isPresenting) {
      if (this.el.getAttribute('visible')) this.el.setAttribute('visible', false);
      return;
    }

    const session = renderer.xr.getSession();
    if (!session) return;

    // Find the XRInputSource that matches our hand
    let source = null;
    for (const s of session.inputSources) {
      if (s.handedness === this.data.hand && s.targetRaySpace) {
        source = s;
        break;
      }
    }
    if (!source) {
      if (this.el.getAttribute('visible')) this.el.setAttribute('visible', false);
      return;
    }
    if (!this.el.getAttribute('visible')) this.el.setAttribute('visible', true);

    // ── Pose update ─────────────────────────────────────────────
    const frame    = scene.frame; // A-Frame stores the current XRFrame here
    const refSpace = renderer.xr.getReferenceSpace();
    if (frame && refSpace && source.targetRaySpace) {
      const pose = frame.getPose(source.targetRaySpace, refSpace);
      if (pose) {
        const p = pose.transform.position;
        const q = pose.transform.orientation;
        this.el.object3D.position.set(p.x, p.y, p.z);
        this.el.object3D.quaternion.set(q.x, q.y, q.z, q.w);
      }
    }

    // ── Gamepad input ───────────────────────────────────────────
    const gp = source.gamepad;
    if (!gp) return;

    // Thumbstick axes — standard mapping: axes[2]=X, axes[3]=Y
    const axisX = gp.axes[2] || gp.axes[0] || 0;
    const axisY = gp.axes[3] || gp.axes[1] || 0;
    if (axisX !== this.lastX || axisY !== this.lastY) {
      this.lastX = axisX;
      this.lastY = axisY;
      this.el.emit('thumbstickmoved', { x: axisX, y: axisY }, false);
    }

    // Grip button (index 2 in standard gamepad mapping, fall back to 1)
    const gripBtn = gp.buttons[2] || gp.buttons[1];
    if (gripBtn) {
      if (gripBtn.pressed && !this.gripPressed) {
        this.gripPressed = true;
        this.el.emit('gripdown', {}, false);
      } else if (!gripBtn.pressed && this.gripPressed) {
        this.gripPressed = false;
        this.el.emit('gripup', {}, false);
      }
    }

    // Trigger button (index 0)
    const trigBtn = gp.buttons[0];
    if (trigBtn) {
      if (trigBtn.pressed && !this.triggerPressed) {
        this.triggerPressed = true;
        this.el.emit('triggerdown', {}, false);
        this._fireCursorClick();
      } else if (!trigBtn.pressed && this.triggerPressed) {
        this.triggerPressed = false;
        this.el.emit('triggerup', {}, false);
      }
    }
  },

  /**
   * Simulate what laser-controls + cursor does: on trigger press, fire 'click'
   * on the entity the raycaster is intersecting.
   */
  _fireCursorClick: function () {
    const rc = this.el.components.raycaster;
    if (!rc) return;
    const els = rc.intersectedEls;
    if (!els || !els.length) return;

    // Walk up ancestors to find the actual interactable / drop-zone entity
    let target = null;
    for (const hit of els) {
      let node = hit;
      while (node && node !== this.el.sceneEl) {
        if (node.classList &&
            (node.classList.contains('interactable') || node.classList.contains('drop-zone'))) {
          target = node;
          break;
        }
        node = node.parentElement;
      }
      if (target) break;
    }
    if (target) {
      target.emit('click', { cursorEl: this.el, intersection: null }, false);
    }
  },

  remove: function () {
    if (this._line) {
      this.el.object3D.remove(this._line);
      this._line.geometry.dispose();
      this._line.material.dispose();
    }
  },
});

/* ─────────────────────────────────────────────
 * SMOOTH LOCOMOTION (left thumbstick)
 * ───────────────────────────────────────────── */
AFRAME.registerComponent('thumbstick-locomotion', {
  schema: {
    speed:    { type: 'number', default: 2.2 },  // metres / second
    deadzone: { type: 'number', default: 0.15 },
  },

  init: function () {
    this.axisX = 0;
    this.axisY = 0;
    this.rig  = document.querySelector('#player');
    this.head = document.querySelector('#head');

    this.onThumbstick = (evt) => {
      const x = evt.detail.x || 0;
      const y = evt.detail.y || 0;
      this.axisX = Math.abs(x) < this.data.deadzone ? 0 : x;
      this.axisY = Math.abs(y) < this.data.deadzone ? 0 : y;
    };
    this.el.addEventListener('thumbstickmoved', this.onThumbstick);

    this._fwd   = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._move  = new THREE.Vector3();
  },

  tick: function (time, delta) {
    if (!this.axisX && !this.axisY) return;
    if (!this.rig || !this.head) return;
    const scene = this.el.sceneEl;
    if (!scene.is('vr-mode')) return;

    const dt = Math.min(delta, 50) / 1000;

    this.head.object3D.getWorldDirection(this._fwd);
    this._fwd.y = 0;
    this._fwd.multiplyScalar(-1).normalize();
    this._right.crossVectors(this._fwd, new THREE.Vector3(0, 1, 0)).normalize();

    this._move.set(0, 0, 0)
      .addScaledVector(this._fwd,  -this.axisY)
      .addScaledVector(this._right, this.axisX);

    if (this._move.lengthSq() > 1) this._move.normalize();
    this._move.multiplyScalar(this.data.speed * dt);

    this.rig.object3D.position.add(this._move);
  },

  remove: function () {
    this.el.removeEventListener('thumbstickmoved', this.onThumbstick);
  },
});

/* ─────────────────────────────────────────────
 * SNAP TURN (right thumbstick, 45° increments)
 * ───────────────────────────────────────────── */
AFRAME.registerComponent('snap-turn', {
  schema: {
    degrees:   { type: 'number', default: 45 },
    threshold: { type: 'number', default: 0.75 },
    resetAt:   { type: 'number', default: 0.35 },
  },

  init: function () {
    this.armed = true;
    this.rig  = document.querySelector('#player');
    this.head = document.querySelector('#head');

    this.onThumbstick = (evt) => {
      const x = evt.detail.x || 0;

      if (Math.abs(x) < this.data.resetAt) { this.armed = true; return; }
      if (!this.armed || Math.abs(x) < this.data.threshold) return;
      this.armed = false;

      const dir = x > 0 ? -1 : 1;
      this.turn(dir * this.data.degrees);
    };
    this.el.addEventListener('thumbstickmoved', this.onThumbstick);
  },

  turn: function (degrees) {
    if (!this.rig || !this.head) return;
    const rad = THREE.MathUtils.degToRad(degrees);

    const headWorld = new THREE.Vector3();
    this.head.object3D.getWorldPosition(headWorld);

    const rigObj = this.rig.object3D;
    rigObj.rotation.y += rad;

    const newHeadWorld = new THREE.Vector3();
    rigObj.updateMatrixWorld(true);
    this.head.object3D.getWorldPosition(newHeadWorld);
    rigObj.position.add(headWorld.sub(newHeadWorld));
  },

  remove: function () {
    this.el.removeEventListener('thumbstickmoved', this.onThumbstick);
  },
});

/* ─────────────────────────────────────────────
 * GRIP GRAB + THROW
 * ───────────────────────────────────────────── */
AFRAME.registerComponent('vr-grab', {
  init: function () {
    this.grabbing = false;

    this.onGripDown = () => {
      const target = this.raycastTarget('interactable');
      if (target && window.bakeryGame) {
        window.bakeryGame.pickUpItem(target, this.el);
        this.grabbing = true;
      }
    };

    this.onGripUp = () => {
      if (!this.grabbing) return;
      this.grabbing = false;
      const game = window.bakeryGame;
      if (!game || !game.heldItem) return;

      const zone = this.raycastTarget('drop-zone');
      if (zone) {
        game.tryPlace(zone);
        if (!game.heldItem) return;
      }
      game.releaseHeldWithPhysics();
    };

    this.el.addEventListener('gripdown', this.onGripDown);
    this.el.addEventListener('gripup', this.onGripUp);
  },

  raycastTarget: function (className) {
    const rc = this.el.components.raycaster;
    if (!rc) return null;
    const els = rc.intersectedEls || [];
    for (const hit of els) {
      let node = hit;
      while (node && node !== this.el.sceneEl) {
        if (node.classList && node.classList.contains(className)) return node;
        node = node.parentElement;
      }
    }
    return null;
  },

  remove: function () {
    this.el.removeEventListener('gripdown', this.onGripDown);
    this.el.removeEventListener('gripup', this.onGripUp);
  },
});

/* ─────────────────────────────────────────────
 * DESKTOP <-> VR MODE MANAGER (on <a-scene>)
 * ───────────────────────────────────────────── */
AFRAME.registerComponent('vr-mode-manager', {
  init: function () {
    const scene = this.el;

    scene.addEventListener('enter-vr', () => {
      const cursor = document.querySelector('#cursor');
      if (cursor) {
        cursor.setAttribute('visible', 'false');
        cursor.setAttribute('raycaster', 'enabled', false);
      }
      document.body.classList.add('in-vr');
      console.log('[vr.js] Entered VR — quest-controller active, desktop cursor disabled');
    });

    scene.addEventListener('exit-vr', () => {
      const cursor = document.querySelector('#cursor');
      if (cursor) {
        cursor.setAttribute('visible', 'true');
        cursor.setAttribute('raycaster', 'enabled', true);
      }
      document.body.classList.remove('in-vr');
      console.log('[vr.js] Exited VR — desktop mode restored');
    });
  },
});
