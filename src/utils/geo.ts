/**
 * Geolocation & Haversine Distance Utilities for SKLADIN
 */
import { PickupPoint } from '../types';

export interface GeoCoordinates {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export interface GeoVerificationResult {
  isWithinRange: boolean;
  distanceMeters: number;
  maxAllowedMeters: number;
  userCoords: { latitude: number; longitude: number };
  warehouseCoords: { latitude: number; longitude: number };
  error?: string;
}

/**
 * Calculates distance between two GPS coordinates in meters using the Haversine formula
 */
export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth radius in metres
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

/**
 * Formats distance into human-friendly string (e.g. "45 м", "1.2 км")
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${meters} м`;
  }
  return `${(meters / 1000).toFixed(1)} км`;
}

/**
 * Gets the current high-accuracy device GPS position
 */
export async function getCurrentBrowserPosition(): Promise<GeoCoordinates> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Геолокация не поддерживается вашим браузером или устройством'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      position => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      error => {
        let msg = 'Не удалось определить геопозицию';
        switch (error.code) {
          case error.PERMISSION_DENIED:
            msg = 'Доступ к геолокации запрещен в настройках браузера. Разрешите доступ к геопозиции для чекина.';
            break;
          case error.POSITION_UNAVAILABLE:
            msg = 'Информация о геопозиции недоступна. Проверьте включен ли GPS в телефоне.';
            break;
          case error.TIMEOUT:
            msg = 'Превышено время ожидания ответа GPS. Попробуйте еще раз на открытом пространстве.';
            break;
        }
        reject(new Error(msg));
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 15000,
      }
    );
  });
}

/**
 * Verifies whether employee's coordinates match warehouse perimeter
 */
export function verifyWarehouseLocation(
  warehouse: PickupPoint,
  userLat: number,
  userLon: number
): GeoVerificationResult {
  const warehouseLat = warehouse.latitude ?? 0;
  const warehouseLon = warehouse.longitude ?? 0;
  const maxAllowedMeters = warehouse.radiusMeters || 300;

  // If warehouse does not have coordinates configured yet, consider geo verified as neutral/pass
  if (!warehouseLat || !warehouseLon) {
    return {
      isWithinRange: true,
      distanceMeters: 0,
      maxAllowedMeters,
      userCoords: { latitude: userLat, longitude: userLon },
      warehouseCoords: { latitude: warehouseLat, longitude: warehouseLon },
    };
  }

  const distanceMeters = calculateDistanceMeters(userLat, userLon, warehouseLat, warehouseLon);
  const isWithinRange = distanceMeters <= maxAllowedMeters;

  return {
    isWithinRange,
    distanceMeters,
    maxAllowedMeters,
    userCoords: { latitude: userLat, longitude: userLon },
    warehouseCoords: { latitude: warehouseLat, longitude: warehouseLon },
    error: isWithinRange
      ? undefined
      : `Вы находитесь в ${formatDistance(distanceMeters)} от склада (допустимо до ${formatDistance(maxAllowedMeters)}). Чекин вне территории склада заблокирован.`,
  };
}
