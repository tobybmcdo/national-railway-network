export const geographyLayers = {
  majorPlaces:{bundle:'geo-major-places',tileZoom:7,minZoom:.0003,maxZoom:.003,control:'cities'},
  places:{bundle:'geo-places',tileZoom:7,minZoom:.003,control:'cities'},
  counties:{bundle:'geo-counties',tileZoom:7,minZoom:.0004},
  zips:{bundle:'geo-zips',tileZoom:8,minZoom:.003},
};

export const boundaryLayers = ['states','counties','zips'];

export function mapLayerEnabled(layers,id) {
  if (id === 'counties' || id === 'zips') return layers[id] === true;
  return layers[id] !== false;
}
