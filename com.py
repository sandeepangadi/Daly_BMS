from flask import Flask, jsonify, render_template
from dalybms import DalyBMS
import minimalmodbus
import serial

app = Flask(__name__, static_folder='.', static_url_path='', template_folder='.')

# -----------------------------
# Configuration
# -----------------------------
BMS_PORT = "/dev/ttyUSB0"
BMS_ADDRESS = 4

METER_PORT = "/dev/ttyUSB1"
METER_ADDRESS = 1
BYTE_ORDER = 0


# -----------------------------
# Read Daly BMS
# -----------------------------
def get_bms_data():
    bms = DalyBMS(request_retries=3, address=BMS_ADDRESS)

    data = {
        "success": False,
        "voltage": 0.0,
        "current": 0.0,
        "soc": 0,
        "status": "Offline",
        "cell_voltages": {}
    }

    try:
        bms.connect(BMS_PORT)

        bms.get_status()

        soc_data = bms.get_soc()

        if soc_data:
            data["voltage"] = soc_data.get("total_voltage", 0.0)
            data["current"] = soc_data.get("current", 0.0)
            data["soc"] = soc_data.get("soc_percent", 0)
            data["success"] = True

            if data["current"] > 0.1:
                data["status"] = "Charging"
            elif data["current"] < -0.1:
                data["status"] = "Discharging"
            else:
                data["status"] = "Standby"

        cell_data = bms.get_cell_voltages()
        if cell_data:
            data["cell_voltages"] = cell_data

    except Exception as e:
        print("BMS Error:", e)

    finally:
        try:
            bms.disconnect()
        except:
            pass

    return data


# -----------------------------
# Read Selec Meter
# -----------------------------
def get_meter_data():
    data = {
        "success": False,
        "voltage": 0.0,
        "current": 0.0,
        "power": 0.0,
        "power_factor": 0.0,
        "frequency": 0.0
    }

    try:
        instrument = minimalmodbus.Instrument(
            METER_PORT,
            METER_ADDRESS
        )

        instrument.serial.baudrate = 9600
        instrument.serial.timeout = 1
        instrument.serial.parity = serial.PARITY_NONE

        data["voltage"] = instrument.read_float(0, 4, 2, BYTE_ORDER)
        data["current"] = instrument.read_float(16, 4, 2, BYTE_ORDER)
        data["power"] = instrument.read_float(42, 4, 2, BYTE_ORDER)
        data["power_factor"] = instrument.read_float(54, 4, 2, BYTE_ORDER)
        data["frequency"] = instrument.read_float(56, 4, 2, BYTE_ORDER)

        data["success"] = True

    except Exception as e:
        print("Meter Error:", e)

    return data


# -----------------------------
# Combined Data
# -----------------------------
def get_all_data():
    return {
        "bms": get_bms_data(),
        "meter": get_meter_data()
    }


# -----------------------------
# Flask Routes
# -----------------------------
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/data")
def api_data():
    return jsonify(get_all_data())


# -----------------------------
# Main
# -----------------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
