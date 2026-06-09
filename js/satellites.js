// satellites.js — Satellite catalog, TLE data, constellation data

window.SATELLITE_CATALOG = {
  25544: { name:'ISS (ZARYA)',      short:'ISS',      color:'#00ffe5', size:5, inc:51.64, period:92.68, alt:408,  emoji:'🛰' },
  20580: { name:'HST (Hubble)',     short:'HUBBLE',   color:'#c084fc', size:4, inc:28.47, period:95.42, alt:537,  emoji:'🔭' },
  48274: { name:'CSS (Tiangong)',   short:'CSS',      color:'#ffaa00', size:4, inc:41.47, period:91.75, alt:390,  emoji:'🚀' },
  43205: { name:'NOAA-20',         short:'NOAA-20',  color:'#60a5fa', size:3, inc:98.74, period:101.3, alt:824,  emoji:'🌤' },
  25338: { name:'NOAA-15',         short:'NOAA-15',  color:'#34d399', size:3, inc:98.73, period:101.1, alt:813,  emoji:'📡' },
  28654: { name:'NOAA-18',         short:'NOAA-18',  color:'#fbbf24', size:3, inc:98.88, period:102.1, alt:854,  emoji:'🌍' },
  27424: { name:'Aqua (NASA)',      short:'AQUA',     color:'#38bdf8', size:3, inc:98.21, period:98.82, alt:705,  emoji:'💧' },
  39084: { name:'Suomi NPP',       short:'SUOMI',    color:'#a78bfa', size:3, inc:98.74, period:101.4, alt:828,  emoji:'🌐' },
  44713: { name:'STARLINK-1007',   short:'STRLNK-A', color:'#fb923c', size:2, inc:53.0,  period:95.8,  alt:550,  emoji:'⭐' },
  44914: { name:'STARLINK-1113',   short:'STRLNK-B', color:'#f472b6', size:2, inc:53.0,  period:95.8,  alt:550,  emoji:'⭐' },
};

window.CONSTELLATION_DATA = [
  { name:'Orion', stars:[[83.8,5.2],[81.3,6.3],[84.1,-1.2],[83.0,-1.9],[82.1,-1.9],[88.8,7.4],[84.7,-9.7],[78.6,-8.2]], lines:[[0,1],[1,2],[2,3],[3,4],[0,5],[2,6],[3,7]] },
  { name:'Ursa Major', stars:[[162,57],[165.5,56.4],[178.5,53.7],[183.9,57],[193.5,55.9],[200.9,54.9],[206.9,49.3]], lines:[[0,1],[1,2],[2,3],[3,4],[4,5],[5,6]] },
  { name:'Cassiopeia', stars:[[2.3,59.1],[10.1,56.5],[14.2,60.7],[21.5,60.2],[28,63.7]], lines:[[0,1],[1,2],[2,3],[3,4]] },
  { name:'Scorpius', stars:[[247.4,-26.4],[240.1,-19.8],[244.5,-15.7],[252.6,-25.6],[253.5,-37.1],[255.2,-29.2],[258,-43]], lines:[[0,1],[1,2],[0,3],[3,4],[4,5],[5,6]] },
  { name:'Leo', stars:[[152.1,11.97],[154.2,19.8],[158.4,14.6],[168.5,15.4],[177.3,14.6],[163.3,20.5]], lines:[[0,1],[1,2],[2,3],[3,4],[2,5],[5,1]] },
  { name:'Cygnus', stars:[[310.4,45.3],[305.5,40.3],[296.2,27.9],[311.5,33.9],[299.7,35.1]], lines:[[0,1],[1,2],[0,3],[3,4],[4,2],[1,4]] },
  { name:'Lyra', stars:[[279.2,38.8],[283.6,36.9],[282,32.7],[284.7,32.7]], lines:[[0,1],[1,2],[2,3],[3,1]] },
  { name:'Aquila', stars:[[286.3,8.9],[287.9,6.4],[284.2,13.9],[290.4,3.1]], lines:[[1,0],[0,2],[0,3]] },
  { name:'Gemini', stars:[[113.6,31.9],[116.3,28.0],[111.8,35.0],[109.5,33.9],[108.2,25.1],[106.0,22.5]], lines:[[0,1],[0,2],[2,3],[1,4],[4,5]] },
  { name:'Perseus', stars:[[51.1,49.9],[46.2,40.0],[47.0,53.5],[56.2,47.7],[41.7,43.1]], lines:[[0,1],[0,2],[0,3],[1,4]] },
];
