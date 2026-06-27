const fs = require('fs');
const path = require('path');

function replaceOnce(content, search, replacement, label) {
  if (!content.includes(search)) {
    console.warn('QA patch skipped: ' + label);
    return content;
  }
  return content.replace(search, replacement);
}

function patchAppLogin() {
  const appFile = path.resolve(__dirname, '../src/App.tsx');
  let content = fs.readFileSync(appFile, 'utf8');

  content = replaceOnce(
    content,
    "    const normalizedEmail = email.trim().toLowerCase();\n    if (!normalizedEmail || !password.trim()) {\n      setError('Enter your email and password.');\n      return;\n    }",
    "    const normalizedEmail = email.trim().toLowerCase();\n    if (!normalizedEmail) {\n      setError('Email is required.');\n      return;\n    }\n\n    if (!password.trim()) {\n      setError('Password is required.');\n      return;\n    }",
    'login field validation'
  );

  fs.writeFileSync(appFile, content);
}

function patchMapPage() {
  const mapFile = path.resolve(__dirname, '../src/components/portal/MapPage.tsx');
  let content = fs.readFileSync(mapFile, 'utf8');

  content = replaceOnce(
    content,
    "function parseCoordinate(value: string) {\n  const coordinate = Number(value.trim());\n  return Number.isFinite(coordinate) ? coordinate : null;\n}",
    "function parseCoordinate(value: string, axis: 'lat' | 'lng') {\n  const trimmed = value.trim();\n  if (!trimmed) return null;\n\n  const coordinate = Number(trimmed);\n  if (!Number.isFinite(coordinate)) return null;\n  if (axis === 'lat' && (coordinate < -90 || coordinate > 90)) return null;\n  if (axis === 'lng' && (coordinate < -180 || coordinate > 180)) return null;\n\n  return coordinate;\n}\n\nfunction hasUsableMapCoordinates(latNumber: number | null, lngNumber: number | null) {\n  if (latNumber === null || lngNumber === null) return false;\n  if (latNumber === 0 && lngNumber === 0) return false;\n  return true;\n}",
    'map coordinate parser'
  );

  content = replaceOnce(
    content,
    "      const latNumber = parseCoordinate(technician.lat);\n      const lngNumber = parseCoordinate(technician.lng);\n\n      if (latNumber === null || lngNumber === null) return [];\n      return [{ ...technician, latNumber, lngNumber }];",
    "      const latNumber = parseCoordinate(technician.lat, 'lat');\n      const lngNumber = parseCoordinate(technician.lng, 'lng');\n\n      if (!hasUsableMapCoordinates(latNumber, lngNumber)) return [];\n      return [{ ...technician, latNumber, lngNumber }];",
    'map point filtering'
  );

  content = replaceOnce(
    content,
    "             <strong>{filteredTechnicianLocations.length}</strong>\n             Visible techs",
    "             <strong>{mapPoints.length}</strong>\n             On map",
    'map counter'
  );

  content = replaceOnce(
    content,
    "               No GPS coordinates yet. The map will show markers as soon as technician GPS data appears.",
    "               No valid GPS coordinates yet. Technicians without GPS stay in the list, but the map stays centered on the service area.",
    'map empty copy'
  );

  fs.writeFileSync(mapFile, content);
}

function patchPortalCounters() {
  const portalFile = path.resolve(__dirname, '../src/CompanyPortal.tsx');
  let content = fs.readFileSync(portalFile, 'utf8');
  content = replaceOnce(
    content,
    '<MetricCard icon={<ClipboardList size={20} />} label="Jobs" value={selectedCompany.usage.jobsThisMonth.toString()} detail="This month" />',
    '<MetricCard icon={<ClipboardList size={20} />} label="Active jobs" value={activeJobsRows.length.toString()} detail="Unpaid / open board" />',
    'portal jobs KPI'
  );
  fs.writeFileSync(portalFile, content);
}

patchAppLogin();
patchMapPage();
patchPortalCounters();
console.log('QA report fixes patch applied.');
