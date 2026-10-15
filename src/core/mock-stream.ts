import type { WSFrame, MockStreamSpeed } from '../types/websocket';

function formatTime(d: Date): string {
  const pad = (n: number, z = 2) => ('00' + n).slice(-z);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export class MockStreamGenerator {
  private timer: any = null;
  private angle = 0;
  private z = 3.62;
  private e = 1.914;
  private frameCounter = 1;
  private onBatch: (frames: WSFrame[]) => void;
  private intervalMs = 50; // 20Hz default
  private isRunning = false;
  private connId = 'ws://192.168.1.108:7125/websocket';
  private monotonic = 32667.536;
  private filamentUsed = 729.936;

  constructor(onBatch: (frames: WSFrame[]) => void) {
    this.onBatch = onBatch;
  }

  public setSpeed(speed: MockStreamSpeed) {
    if (speed === '10Hz') this.intervalMs = 100;
    else if (speed === '20Hz') this.intervalMs = 50;
    else if (speed === '50Hz') this.intervalMs = 20;

    if (this.isRunning) {
      this.stop();
      this.start();
    }
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;

    // Send an initial handshake frame
    const now = new Date();
    const initFrame: WSFrame = {
      id: `frame-${this.frameCounter++}`,
      connectionId: this.connId,
      direction: 'in',
      timestamp: now.getTime(),
      timeFormatted: formatTime(now),
      length: 88,
      payload: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notify_klippy_ready',
        params: ['klippy_ready'],
      }),
      jsonPayload: {
        jsonrpc: '2.0',
        method: 'notify_klippy_ready',
        params: ['klippy_ready'],
      },
      isJson: true,
    };
    this.onBatch([initFrame]);

    this.timer = setInterval(() => {
      this.tick();
    }, this.intervalMs);
  }

  public stop() {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public active(): boolean {
    return this.isRunning;
  }

  private tick() {
    const batch: WSFrame[] = [];
    const now = new Date();
    const ts = now.getTime();
    const timeFormatted = formatTime(now);

    this.monotonic += 0.05;
    this.angle += 0.08;
    this.z += 0.001;
    this.e += 0.004;
    this.filamentUsed += 0.015;

    // Center motion simulation around 100, 130
    const radius = 25 + Math.sin(this.angle * 0.4) * 8;
    const x = Number((100 + radius * Math.cos(this.angle)).toFixed(3));
    const y = Number((130 + radius * Math.sin(this.angle)).toFixed(3));
    const z = Number(this.z.toFixed(3));
    const e = Number(this.e.toFixed(5));

    const tempExtruder = Number((203.6 + Math.sin(this.angle * 0.2) * 1.5).toFixed(2));
    const chamberTemp = Number((34.2 + Math.sin(this.angle * 0.05) * 0.4).toFixed(2));
    const progress = Math.min(0.99, Number((0.185 + (this.frameCounter * 0.0001)).toFixed(6)));

    // Realistic Moonraker / Klipper notify_status_update matching production multi-extruder 3D printer
    const statusPayload = {
      jsonrpc: '2.0',
      method: 'notify_status_update',
      params: [
        {
          gcode_move: {
            speed: 1200.0,
            homing_origin: [0.131, -0.128, 0.021, 0.0],
            position: [x, y, z, e],
            gcode_position: [Number((x - 0.131).toFixed(3)), Number((y + 0.128).toFixed(3)), Number((z - 0.021).toFixed(3)), e],
          },
          print_stats: {
            total_duration: 791.79 + this.frameCounter * 0.05,
            print_duration: 770.5 + this.frameCounter * 0.05,
            filament_used: Number(this.filamentUsed.toFixed(3)),
          },
          box: {
            T1: {
              state: 'connect',
              filament: 'D',
              temperature: '0',
              dry_and_humidity: '0',
              filament_detected: 'None',
              measuring_wheel: 959.96,
              version: '2.2.2',
              mode: '2',
              color_value: ['0ffffff', '0ff6262', '0ce58f8', '066fba2'],
              material_type: ['001001', '001001', '001001', '001001'],
              type: 'CFS-Nano',
            },
          },
          idle_timeout: {
            printing_time: 791.6 + this.frameCounter * 0.05,
          },
          virtual_sdcard: {
            progress,
            file_position: 139512 + this.frameCounter * 20,
          },
          nozzle_manager: {
            selected: 3,
            current_extruder: {
              temperature: tempExtruder,
              target: 220.0,
              power: 0.11,
            },
            nozzle_temp: [
              { id: 0, temperature: 209.38, target: 140.0, power: 0.0 },
              { id: 1, temperature: 173.38, target: 200.0, power: 0.0 },
              { id: 2, temperature: 203.97, target: 140.0, power: 0.0 },
              { id: 3, temperature: tempExtruder, target: 220.0, power: 0.11 },
            ],
          },
          'temperature_sensor chamber_temp': {
            temperature: chamberTemp,
          },
          exclude_object: {
            current_object: '立方体_ID_2_COPY_0',
          },
          motion_report: {
            live_position: [x, y, z, e],
            live_velocity: Number((Math.sin(this.angle) * 120.0).toFixed(2)),
          },
          system_stats: {
            monotonic: Number(this.monotonic.toFixed(3)),
          },
          toolhead: {
            print_time: 29682.0 + this.frameCounter * 0.05,
            estimated_print_time: 29679.95,
            position: [x, y, z, e],
            max_velocity: 800.0,
            max_accel: 5000.0,
            max_accel_to_decel: 5000.0,
            square_corner_velocity: 8.0,
          },
          extruder: { temperature: 209.38 },
          extruder1: { temperature: 173.38, target: 200.0 },
          extruder2: { temperature: 203.97 },
          extruder3: { temperature: tempExtruder, target: 220.0 },
        },
        Number(this.monotonic.toFixed(3)),
      ],
    };

    const statusStr = JSON.stringify(statusPayload);
    batch.push({
      id: `frame-${this.frameCounter++}`,
      connectionId: this.connId,
      direction: 'in',
      timestamp: ts,
      timeFormatted,
      length: statusStr.length,
      payload: statusStr,
      jsonPayload: statusPayload,
      isJson: true,
    });

    // Occasional outgoing query or command (every 25 frames)
    if (this.frameCounter % 25 === 0) {
      const queryPayload = {
        jsonrpc: '2.0',
        method: 'printer.objects.query',
        params: {
          objects: {
            motion_report: ['live_position', 'live_velocity'],
            virtual_sdcard: ['progress', 'file_position'],
            exclude_object: ['current_object'],
          },
        },
        id: Math.floor(this.frameCounter / 25),
      };
      const queryStr = JSON.stringify(queryPayload);
      batch.push({
        id: `frame-${this.frameCounter++}`,
        connectionId: this.connId,
        direction: 'out',
        timestamp: ts + 1,
        timeFormatted,
        length: queryStr.length,
        payload: queryStr,
        jsonPayload: queryPayload,
        isJson: true,
      });
    }

    this.onBatch(batch);
  }
}
