const FIT_EPOCH_MS = Date.UTC(1989, 11, 31);
const FIT_CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400,
  0xf001, 0x3c00, 0x2800, 0xe401,
  0xa001, 0x6c00, 0x7800, 0xb401,
  0x5000, 0x9c01, 0x8801, 0x4400,
];

const MESSAGE_NAMES = {
  0: "file_id",
  18: "session",
  19: "lap",
  20: "record",
  21: "event",
  23: "device_info",
  26: "developer_data_id",
  27: "field_description",
  34: "activity",
  49: "file_creator",
  78: "hr",
  101: "length",
  128: "weather_conditions",
  206: "suunto_field_description",
  207: "suunto_developer_id",
};

const SPORT_NAMES = {
  0: "Generic",
  1: "Running",
  2: "Cycling",
  4: "Fitness equipment",
  5: "Swimming",
  10: "Training",
  11: "Walking",
  12: "Cross-country skiing",
  13: "Alpine skiing",
  14: "Snowboarding",
  15: "Rowing",
  16: "Mountaineering",
  17: "Hiking",
  18: "Multisport",
  19: "Paddling",
  21: "E-biking",
  23: "Boating",
  29: "Water sports",
  254: "All",
  255: "Other",
};

// Names and FIT profile scales for the fields used by the overview.
const FIELD_META = {
  0: {
    0: { name: "type", label: "File type" },
    1: { name: "manufacturer", label: "Manufacturer" },
    2: { name: "product", label: "Product" },
    3: { name: "serial_number", label: "Serial number" },
    4: { name: "time_created", label: "Created", kind: "timestamp" },
    8: { name: "product_name", label: "Product name" },
  },
  18: {
    0: { name: "event", label: "Event" },
    1: { name: "event_type", label: "Event type" },
    2: { name: "start_time", label: "Start time", kind: "timestamp" },
    5: { name: "sport", label: "Sport", kind: "sport" },
    7: { name: "total_elapsed_time", label: "Elapsed time", scale: 0.001, unit: "s" },
    8: { name: "total_timer_time", label: "Timer time", scale: 0.001, unit: "s" },
    9: { name: "total_distance", label: "Distance", scale: 0.01, unit: "m" },
    11: { name: "total_calories", label: "Calories", unit: "kcal" },
    13: { name: "total_fat_calories", label: "Fat calories", unit: "kcal" },
    14: { name: "avg_speed", label: "Average speed", scale: 0.001, unit: "m/s" },
    15: { name: "max_speed", label: "Maximum speed", scale: 0.001, unit: "m/s" },
    16: { name: "avg_heart_rate", label: "Average heart rate", unit: "bpm" },
    17: { name: "max_heart_rate", label: "Maximum heart rate", unit: "bpm" },
    18: { name: "avg_cadence", label: "Average cadence", unit: "rpm" },
    19: { name: "max_cadence", label: "Maximum cadence", unit: "rpm" },
    22: { name: "total_ascent", label: "Elevation gain", unit: "m" },
    23: { name: "total_descent", label: "Elevation loss", unit: "m" },
    24: { name: "total_training_effect", label: "Training Effect", scale: 0.1 },
    26: { name: "num_laps", label: "Laps" },
    35: { name: "training_stress_score", label: "Training Stress Score", scale: 0.1, unit: "TSS" },
    64: { name: "min_heart_rate", label: "Minimum heart rate", unit: "bpm" },
    65: { name: "time_in_hr_zone", label: "Time in heart-rate zone", scale: 0.001, unit: "s" },
    253: { name: "timestamp", label: "Timestamp", kind: "timestamp" },
  },
  19: {
    0: { name: "event", label: "Event" },
    1: { name: "event_type", label: "Event type" },
    2: { name: "start_time", label: "Start time", kind: "timestamp" },
    7: { name: "total_elapsed_time", label: "Elapsed time", scale: 0.001, unit: "s" },
    8: { name: "total_timer_time", label: "Timer time", scale: 0.001, unit: "s" },
    9: { name: "total_distance", label: "Distance", scale: 0.01, unit: "m" },
    11: { name: "total_calories", label: "Calories", unit: "kcal" },
    12: { name: "total_fat_calories", label: "Fat calories", unit: "kcal" },
    13: { name: "avg_speed", label: "Average speed", scale: 0.001, unit: "m/s" },
    14: { name: "max_speed", label: "Maximum speed", scale: 0.001, unit: "m/s" },
    15: { name: "avg_heart_rate", label: "Average heart rate", unit: "bpm" },
    16: { name: "max_heart_rate", label: "Maximum heart rate", unit: "bpm" },
    17: { name: "avg_cadence", label: "Average cadence", unit: "rpm" },
    18: { name: "max_cadence", label: "Maximum cadence", unit: "rpm" },
    21: { name: "total_ascent", label: "Elevation gain", unit: "m" },
    22: { name: "total_descent", label: "Elevation loss", unit: "m" },
    253: { name: "timestamp", label: "Timestamp", kind: "timestamp" },
  },
  20: {
    253: { name: "timestamp", label: "Timestamp", kind: "timestamp" },
    0: { name: "position_lat", label: "Latitude", kind: "latitude" },
    1: { name: "position_long", label: "Longitude", kind: "longitude" },
    2: { name: "altitude", label: "Altitude", scale: 0.2, offset: -500, unit: "m" },
    3: { name: "heart_rate", label: "Heart rate", unit: "bpm" },
    4: { name: "cadence", label: "Cadence", unit: "rpm" },
    5: { name: "distance", label: "Distance", scale: 0.01, unit: "m" },
    6: { name: "speed", label: "Speed", scale: 0.001, unit: "m/s" },
    7: { name: "power", label: "Power", unit: "watts" },
    8: { name: "grade", label: "Grade", scale: 0.01, unit: "%" },
    9: { name: "resistance", label: "Resistance" },
    13: { name: "temperature", label: "Temperature", unit: "C" },
    31: { name: "gps_accuracy", label: "GPS accuracy", unit: "m" },
    32: { name: "vertical_speed", label: "Vertical speed", scale: 0.001, unit: "m/s" },
    33: { name: "calories", label: "Calories", unit: "kcal" },
    73: { name: "enhanced_speed", label: "Enhanced speed", scale: 0.001, unit: "m/s" },
    78: { name: "enhanced_altitude", label: "Enhanced altitude", scale: 0.001, offset: -500, unit: "m" },
  },
  128: {
    0: { name: "weather_report", label: "Weather report" },
    1: { name: "temperature", label: "Temperature", unit: "C" },
    2: { name: "weather_condition", label: "Weather condition" },
    3: { name: "wind_direction", label: "Wind direction", unit: "degrees" },
    4: { name: "wind_speed", label: "Wind speed", scale: 0.001, unit: "m/s" },
    5: { name: "precipitation_probability", label: "Precipitation probability", unit: "%" },
    6: { name: "temperature_feels_like", label: "Feels like temperature", unit: "C" },
    7: { name: "relative_humidity", label: "Relative humidity", unit: "%" },
    8: { name: "weather_location", label: "Weather location" },
    9: { name: "observed_at_time", label: "Observed at", kind: "timestamp" },
    10: { name: "observed_location_lat", label: "Observed latitude", kind: "latitude" },
    11: { name: "observed_location_long", label: "Observed longitude", kind: "longitude" },
    253: { name: "timestamp", label: "Timestamp", kind: "timestamp" },
  },
  206: {
    0: { name: "developer_data_index", label: "Developer data index" },
    1: { name: "field_definition_number", label: "Field definition number" },
    2: { name: "fit_base_type_id", label: "FIT base type" },
    3: { name: "field_name", label: "Developer field name" },
    6: { name: "scale", label: "Scale" },
    7: { name: "offset", label: "Offset" },
    8: { name: "units", label: "Units" },
  },
  207: {
    1: { name: "application_id", label: "Application ID" },
    3: { name: "developer_data_index", label: "Developer data index" },
  },
  23: {
    0: { name: "device_index", label: "Device index" },
    1: { name: "device_type", label: "Device type" },
    2: { name: "manufacturer", label: "Manufacturer" },
    3: { name: "serial_number", label: "Serial number" },
    4: { name: "product", label: "Product" },
    5: { name: "software_version", label: "Software version", scale: 100 },
    10: { name: "battery_voltage", label: "Battery voltage", scale: 256, unit: "V" },
    11: { name: "battery_status", label: "Battery status" },
    27: { name: "device_name", label: "Recording device" },
  },
  34: {
    0: { name: "timestamp", label: "Timestamp", kind: "timestamp" },
    1: { name: "total_timer_time", label: "Timer time", scale: 0.001, unit: "s" },
    2: { name: "num_sessions", label: "Sessions" },
    3: { name: "type", label: "Activity type" },
  },
};

const TYPE_WIDTHS = {
  0: 1, 1: 1, 2: 1, 3: 2, 4: 2, 5: 4, 6: 4, 7: 1, 8: 4, 9: 8,
  10: 1, 11: 2, 12: 4, 13: 1, 14: 8, 15: 8, 16: 8,
};

function fieldMeta(globalNumber, fieldNumber) {
  return FIELD_META[globalNumber]?.[fieldNumber] ?? {
    name: `field_${fieldNumber}`,
    label: `Field ${fieldNumber}`,
  };
}

function isInvalid(value, type) {
  if (value === null || value === undefined) return true;
  if (typeof value === "number" && Number.isNaN(value)) return true;
  return (
    (type === 1 && value === 0x7f) ||
    (type === 2 && value === 0xff) ||
    (type === 3 && value === 0x7fff) ||
    (type === 4 && value === 0xffff) ||
    (type === 5 && value === 0x7fffffff) ||
    (type === 6 && value === 0xffffffff)
  );
}

function decodePrimitive(view, bytes, offset, type, littleEndian) {
  switch (type) {
    case 0:
    case 2:
    case 10:
    case 13:
      return bytes[offset];
    case 1:
      return view.getInt8(offset);
    case 3:
      return view.getInt16(offset, littleEndian);
    case 4:
    case 11:
      return view.getUint16(offset, littleEndian);
    case 5:
      return view.getInt32(offset, littleEndian);
    case 6:
    case 12:
      return view.getUint32(offset, littleEndian);
    case 8:
      return view.getFloat32(offset, littleEndian);
    case 9:
      return view.getFloat64(offset, littleEndian);
    case 14:
      return Number(view.getBigInt64(offset, littleEndian));
    case 15:
    case 16:
      return Number(view.getBigUint64(offset, littleEndian));
    default:
      return null;
  }
}

function decodeField(view, bytes, offset, size, baseType, architecture) {
  const type = baseType & 0x1f;
  if (type === 7) {
    return new TextDecoder().decode(bytes.slice(offset, offset + size)).replace(/\0.*$/, "").trim();
  }
  if (type === 13 && size > 1) return Array.from(bytes.slice(offset, offset + size));

  const width = TYPE_WIDTHS[type] ?? size;
  const littleEndian = architecture === 0;
  const values = [];
  for (let cursor = 0; cursor + width <= size; cursor += width) {
    const value = decodePrimitive(view, bytes, offset + cursor, type, littleEndian);
    values.push(isInvalid(value, type) ? null : value);
  }
  if (values.length === 1) return values[0];
  return values;
}

function normalizeValue(value, meta) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item, meta));
  if (meta.scale !== undefined && typeof value === "number") value *= meta.scale;
  if (meta.offset !== undefined && typeof value === "number") value += meta.offset;
  if (meta.kind === "latitude" || meta.kind === "longitude") return value * (180 / 2147483648);
  return value;
}

function normalizeDeveloperValue(value, description) {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  const scale = description?.scale;
  const offset = description?.offset;
  if (typeof scale === "number" && Number.isFinite(scale) && scale > 0) value /= scale;
  if (typeof offset === "number" && Number.isFinite(offset)) value -= offset;
  return value;
}

function fieldValue(fields, name) {
  return fields[name] === undefined || fields[name] === null ? null : fields[name];
}

function decodeDefinition(bytes, offset, header) {
  const reserved = bytes[offset];
  const architecture = bytes[offset + 1];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const globalNumber = view.getUint16(offset + 2, architecture === 0);
  const numberOfFields = bytes[offset + 4];
  let cursor = offset + 5;
  const fields = [];
  for (let index = 0; index < numberOfFields; index += 1) {
    fields.push({ number: bytes[cursor], size: bytes[cursor + 1], baseType: bytes[cursor + 2] });
    cursor += 3;
  }
  const developerFields = [];
  if (header & 0x20) {
    const numberOfDeveloperFields = bytes[cursor];
    cursor += 1;
    for (let index = 0; index < numberOfDeveloperFields; index += 1) {
      developerFields.push({ developer: true, number: bytes[cursor], size: bytes[cursor + 1], developerDataIndex: bytes[cursor + 2] });
      cursor += 3;
    }
  }
  return { definition: { architecture, globalNumber, fields, developerFields, reserved }, nextOffset: cursor };
}

function fitDate(seconds) {
  return typeof seconds === "number" && Number.isFinite(seconds) ? new Date(FIT_EPOCH_MS + seconds * 1000) : null;
}

function asBytes(buffer) {
  return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
}

export function fitCrc(buffer, start = 0, end) {
  const bytes = asBytes(buffer);
  let crc = 0;
  const finalOffset = end ?? bytes.length;
  for (let offset = start; offset < finalOffset; offset += 1) {
    crc = (crc >>> 4) ^ FIT_CRC_TABLE[(crc ^ bytes[offset]) & 0x0f];
    crc = (crc >>> 4) ^ FIT_CRC_TABLE[(crc ^ (bytes[offset] >>> 4)) & 0x0f];
  }
  return crc & 0xffff;
}

export function validateFit(buffer) {
  const bytes = asBytes(buffer);
  if (bytes.length < 14 || String.fromCharCode(...bytes.slice(8, 12)) !== ".FIT") {
    throw new Error("This does not look like a FIT file.");
  }
  const headerSize = bytes[0];
  if (headerSize < 12 || headerSize + 2 > bytes.length) throw new Error("The FIT header is incomplete.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dataSize = view.getUint32(4, true);
  const dataEnd = headerSize + dataSize;
  if (dataEnd + 2 !== bytes.length) throw new Error("The FIT file size does not match its header.");

  let headerCrc = null;
  if (headerSize >= 14) {
    const expectedHeaderCrc = view.getUint16(headerSize - 2, true);
    const calculatedHeaderCrc = fitCrc(bytes, 0, headerSize - 2);
    if (expectedHeaderCrc !== calculatedHeaderCrc) throw new Error("The FIT header CRC is invalid.");
    headerCrc = expectedHeaderCrc;
  }
  const expectedFileCrc = view.getUint16(dataEnd, true);
  const calculatedFileCrc = fitCrc(bytes, 0, dataEnd);
  if (expectedFileCrc !== calculatedFileCrc) throw new Error("The FIT file CRC is invalid.");
  return { headerSize, dataSize, dataEnd, headerCrc, fileCrc: expectedFileCrc };
}

export function dateFromFit(seconds) {
  return fitDate(seconds);
}

export function sportName(value) {
  return SPORT_NAMES[value] ?? (value === null || value === undefined ? "Unknown activity" : `Sport ${value}`);
}

export function messageName(globalNumber) {
  return MESSAGE_NAMES[globalNumber] ?? `message_${globalNumber}`;
}

export function decodeFit(buffer) {
  const bytes = asBytes(buffer);
  const integrity = validateFit(bytes);
  const headerSize = integrity.headerSize;
  const headerView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dataSize = integrity.dataSize;
  const dataStart = headerSize;
  const dataEnd = integrity.dataEnd;
  const protocolVersion = bytes[1];
  const profileVersion = headerView.getUint16(2, true);
  const definitions = new Map();
  const messages = [];
  const messageCounts = new Map();
  let offset = dataStart;
  let lastTimestamp = null;

  while (offset < dataEnd) {
    const header = bytes[offset];
    offset += 1;
    if (header & 0x40) {
      const parsedDefinition = decodeDefinition(bytes, offset, header);
      definitions.set(header & 0x0f, parsedDefinition.definition);
      offset = parsedDefinition.nextOffset;
      continue;
    }

    const localNumber = header & 0x80 ? (header >> 5) & 0x03 : header & 0x0f;
    const definition = definitions.get(localNumber);
    if (!definition) throw new Error(`FIT message refers to unknown definition ${localNumber}.`);
    const dataFields = [...definition.fields, ...definition.developerFields];
    const rawFields = {};
    const fields = {};
    const fieldDetails = {};
    const developerValues = [];
    let cursor = offset;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (const field of dataFields) {
      const fieldBytes = bytes.slice(cursor, cursor + field.size);
      const raw = field.developer
        ? decodeField(new DataView(fieldBytes.buffer, fieldBytes.byteOffset, fieldBytes.byteLength), fieldBytes, 0, field.size, 0x0d, definition.architecture)
        : decodeField(view, bytes, cursor, field.size, field.baseType, definition.architecture);
      const standard = !field.developer;
      const meta = standard ? fieldMeta(definition.globalNumber, field.number) : { name: `developer_${field.developerDataIndex}_${field.number}`, label: "Developer field" };
      const name = meta.name;
      rawFields[name] = raw;
      fields[name] = standard ? normalizeValue(raw, meta) : raw;
      fieldDetails[name] = {
        name,
        label: meta.label,
        unit: meta.unit,
        baseType: field.baseType ?? null,
        fieldNumber: field.number,
        developer: Boolean(field.developer),
        developerDataIndex: field.developerDataIndex,
      };
      if (field.developer) {
        developerValues.push({
          bytes: fieldBytes,
          developerDataIndex: field.developerDataIndex,
          fieldNumber: field.number,
          size: field.size,
        });
      }
      cursor += field.size;
    }
    offset = cursor;

    if (header & 0x80) {
      const offsetSeconds = header & 0x1f;
      if (lastTimestamp !== null) {
        let compressedTimestamp = (lastTimestamp & ~0x1f) | offsetSeconds;
        if (compressedTimestamp <= lastTimestamp) compressedTimestamp += 0x20;
        fields.timestamp ??= compressedTimestamp;
        rawFields.timestamp ??= compressedTimestamp;
      }
    }
    if (typeof fields.timestamp === "number") lastTimestamp = fields.timestamp;

    const globalNumber = definition.globalNumber;
    const currentCount = (messageCounts.get(globalNumber) ?? 0) + 1;
    messageCounts.set(globalNumber, currentCount);
    messages.push({
      globalNumber,
      name: messageName(globalNumber),
      localNumber,
      fields,
      rawFields,
      fieldDetails,
      developerValues,
      definition,
      sequence: messages.length,
    });
  }

  // Suunto writes the FIT developer descriptions before the time-series data.
  // Resolve those labels and base types after parsing so the raw message order
  // does not matter and future pages can use the same named fields.
  const developerDescriptions = new Map();
  messages.filter((message) => message.globalNumber === 206).forEach((message) => {
    const developerDataIndex = getField(message, "developer_data_index");
    const fieldNumber = getField(message, "field_definition_number");
    const fieldName = getField(message, "field_name");
    const baseType = getField(message, "fit_base_type_id");
    if (developerDataIndex === null || fieldNumber === null || typeof fieldName !== "string") return;
    developerDescriptions.set(`${developerDataIndex}:${fieldNumber}`, {
      name: fieldName,
      units: getField(message, "units"),
      baseType,
      scale: getField(message, "scale"),
      offset: getField(message, "offset"),
    });
  });

  messages.forEach((message) => {
    message.developerValues?.forEach((developerValue) => {
      const description = developerDescriptions.get(`${developerValue.developerDataIndex}:${developerValue.fieldNumber}`);
      const genericName = `developer_${developerValue.developerDataIndex}_${developerValue.fieldNumber}`;
      const name = description?.name || genericName;
      const bytesForField = developerValue.bytes;
      const decodedValue = description?.baseType === null || description?.baseType === undefined
        ? Array.from(bytesForField)
        : decodeField(new DataView(bytesForField.buffer, bytesForField.byteOffset, bytesForField.byteLength), bytesForField, 0, developerValue.size, description.baseType, message.definition.architecture);
      const value = normalizeDeveloperValue(decodedValue, description);
      delete message.fields[genericName];
      delete message.rawFields[genericName];
      delete message.fieldDetails[genericName];
      message.fields[name] = value;
      message.rawFields[name] = decodedValue;
      message.fieldDetails[name] = {
        name,
        label: name,
        unit: description?.units || null,
        baseType: description?.baseType ?? null,
        scale: description?.scale ?? null,
        offset: description?.offset ?? null,
        fieldNumber: developerValue.fieldNumber,
        developer: true,
        developerDataIndex: developerValue.developerDataIndex,
      };
    });
    delete message.developerValues;
  });

  const fileId = messages.find((message) => message.globalNumber === 0);
  const session = messages.filter((message) => message.globalNumber === 18).at(-1) ?? null;
  const records = messages.filter((message) => message.globalNumber === 20);
  return {
    header: { size: headerSize, dataSize, protocolVersion, profileVersion, fileSize: bytes.length, integrity },
    fileId,
    session,
    records,
    messages,
    messageCounts,
    messageTypes: [...messageCounts.keys()].map((globalNumber) => ({ globalNumber, name: messageName(globalNumber), count: messageCounts.get(globalNumber) })),
  };
}

export function getField(message, name) {
  return message ? fieldValue(message.fields, name) : null;
}
