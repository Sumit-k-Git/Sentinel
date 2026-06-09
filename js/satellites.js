// satellites.js — Satellite catalog and orbital constants

window.SATELLITES = {
  ISS: {
    id: 25544,
    name: 'ISS (ZARYA)',
    shortName: 'ISS',
    color: '#00ffa3',
    trailColor: 'rgba(0,255,163,',
    size: 5,
    inclination: 51.64,
    periodMin: 92.68,
    altitudeKm: 408,
  },
};

// Constellation data — RA/Dec converted to approximate screen positions
// Stored as sequences of [lon, lat] pairs for equirectangular mapping
window.CONSTELLATION_DATA = [
  {
    name: 'Orion',
    stars: [
      [83.8, 5.2],   // Betelgeuse
      [81.3, 6.3],   // Bellatrix
      [84.1, -1.2],  // Alnitak
      [83.0, -1.9],  // Alnilam
      [82.1, -1.9],  // Mintaka
      [88.8, 7.4],   // Rigel — purposely shifted for layout
      [84.1, -1.2],  // back to Alnitak
      [84.7, -9.7],  // Saiph
      [78.6, -8.2],  // Rigel (actual)
    ],
    lines: [[0,1],[1,2],[2,3],[3,4],[0,5],[2,6],[3,7],[4,8]],
  },
  {
    name: 'Ursa Major',
    stars: [
      [162.0, 57.0], [165.5, 56.4], [178.5, 53.7],
      [183.9, 57.0], [193.5, 55.9], [200.9, 54.9], [206.9, 49.3],
    ],
    lines: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6]],
  },
  {
    name: 'Cassiopeia',
    stars: [
      [2.3, 59.1],   // Caph
      [10.1, 56.5],  // Schedar
      [14.2, 60.7],  // Gamma Cas
      [21.5, 60.2],  // Ruchbah
      [28.0, 63.7],  // Segin
    ],
    lines: [[0,1],[1,2],[2,3],[3,4]],
  },
  {
    name: 'Scorpius',
    stars: [
      [247.4, -26.4], // Antares
      [240.1, -19.8],
      [244.5, -15.7],
      [252.6, -25.6],
      [253.5, -37.1],
      [255.2, -29.2],
      [258.0, -43.0],
      [256.9, -34.3],
    ],
    lines: [[0,1],[1,2],[0,3],[3,4],[4,5],[5,6],[6,7]],
  },
  {
    name: 'Leo',
    stars: [
      [152.1, 11.97], // Regulus
      [154.2, 19.8],
      [158.4, 14.6],
      [168.5, 15.4],
      [177.3, 14.6], // Denebola
      [163.3, 20.5],
    ],
    lines: [[0,1],[1,2],[2,3],[3,4],[2,5],[5,1]],
  },
  {
    name: 'Cygnus',
    stars: [
      [310.4, 45.3],  // Deneb
      [305.5, 40.3],
      [296.2, 27.9],  // Albireo
      [311.5, 33.9],
      [299.7, 35.1],
    ],
    lines: [[0,1],[1,2],[0,3],[3,4],[4,2],[1,4]],
  },
  {
    name: 'Lyra',
    stars: [
      [279.2, 38.8],  // Vega
      [283.6, 36.9],
      [282.0, 32.7],
      [284.7, 32.7],
      [283.6, 36.9],
    ],
    lines: [[0,1],[1,2],[2,3],[3,4]],
  },
  {
    name: 'Aquila',
    stars: [
      [286.3, 8.9],  // Altair
      [287.9, 6.4],
      [284.2, 13.9],
      [286.3, 8.9],
      [290.4, 3.1],
    ],
    lines: [[1,0],[0,2],[0,3],[3,4]],
  },
];
