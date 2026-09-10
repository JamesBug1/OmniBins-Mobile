import React from 'react';
import Svg, { Path, Rect, Line, Circle, Text } from 'react-native-svg';

const PRIMARY_GREEN = '#00a63e';

export const HomeIcon = ({ size = 32, color = PRIMARY_GREEN }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <Path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <Path d="M9 22V12h6v10" />
  </Svg>
);

export const CalendarIcon = ({ size = 32, color = PRIMARY_GREEN }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <Rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <Line x1="16" y1="2" x2="16" y2="6" />
    <Line x1="8" y1="2" x2="8" y2="6" />
    <Line x1="3" y1="10" x2="21" y2="10" />
  </Svg>
);

export const ProfileIcon = ({ size = 32, color = PRIMARY_GREEN }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <Circle cx="12" cy="7" r="4" />
  </Svg>
);

export const LocationIcon = ({ size = 32, color = PRIMARY_GREEN }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
    <Path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
  </Svg>
);

export const AlertIcon = ({ size = 32, color = PRIMARY_GREEN }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <Path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    <Line x1="12" y1="7" x2="12" y2="11" />
    <Line x1="12" y1="15" x2="12.01" y2="15" />
  </Svg>
);

export const MapIcon = ({ size = 32, color = PRIMARY_GREEN }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <Path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z" />
    <Line x1="8" y1="2" x2="8" y2="18" />
    <Line x1="16" y1="6" x2="16" y2="22" />
  </Svg>
);

export const NotificationIcon = ({ size = 32, color = '#ffffff', badgeCount = 3 }) => {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Path
        d="M24 12A8 8 0 0 0 8 12c0 9.333-4 12-4 12h24s-4-2.667-4-12"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M18.3 29.333a2.667 2.667 0 0 1-4.6 0"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {badgeCount > 0 && (
        <>
          <Circle cx="25" cy="7" r="8" fill="#ef4444" stroke={PRIMARY_GREEN} strokeWidth="2" />
          <Text
            x="25"
            y="11"
            fill="#ffffff"
            fontSize="10"
            fontWeight="bold"
            textAnchor="middle"
          >
            {String(badgeCount > 9 ? '9+' : badgeCount)}
          </Text>
        </>
      )}
    </Svg>
  );
};

export const ChevronRightIcon = ({ size = 20, color = '#717171' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <Path d="M9 18l6-6-6-6" />
  </Svg>
);

export const TruckIcon = ({ size = 48, color = '#8BC34A' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M8 5h12c1.1 0 2 .9 2 2v9h-2c0 1.66-1.34 3-3 3s-3-1.34-3-3H10c0 1.66-1.34 3-3 3s-3-1.34-3-3H2V9l3-4h3v11h1V5z" fill={color} />
    <Path d="M3.5 9L5 6.5h2V9H3.5z" fill="#ffffff" />
    <Circle cx="7" cy="17" r="2" fill="#333333" />
    <Circle cx="17" cy="17" r="2" fill="#333333" />
  </Svg>
);

export const SimpleBinIcon = ({ size = 40, color = PRIMARY_GREEN }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M6 7v12a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const OrangeCleaningIcon = ({ size = 64 }) => {
  const mainColor = '#FF9800';
  const bgColor = '#FFF3E0';
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">

      <Path d="M8 12h8v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V12z" stroke={mainColor} strokeWidth="1.5" />
      <Path d="M10 12v-2a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2" stroke={mainColor} strokeWidth="1.5" />
      <Line x1="10.5" y1="15" x2="10.5" y2="21" stroke={mainColor} strokeWidth="1.5" strokeLinecap="round" />
      <Line x1="13.5" y1="15" x2="13.5" y2="21" stroke={mainColor} strokeWidth="1.5" strokeLinecap="round" />
      <Path d="M16 20c0-3 2-6 4-7 2 1 4 4 4 7 0 2.5-1.5 4-4 4s-4-1.5-4-4z" fill={bgColor} stroke={mainColor} strokeWidth="1.5" strokeLinejoin="round" />
      <Line x1="19" y1="13" x2="21" y2="13" stroke={mainColor} strokeWidth="1.5" strokeLinecap="round" />
      <Line x1="8" y1="26" x2="23" y2="26" stroke={mainColor} strokeWidth="1.5" strokeLinecap="round" />
      <Path d="M22 6l.5 1.5L24 8l-1.5.5L22 10l-.5-1.5L20 8l1.5-.5z" fill={mainColor} />
      <Path d="M18 9l.5 1 L20 10.5 l-1.5 .5 L18 12 l-.5 -1 L16 10.5 l1.5 -.5z" fill={mainColor} />
    </Svg>
  );
};

export const ClipboardCheckIcon = ({ size = 60 }) => {
  const mainColor = '#00E676';
  const bgColor = '#E8F5E9';
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Path d="M19 6h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2" stroke={mainColor} strokeWidth="2" strokeLinecap="round" />
      <Path d="M13 5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V5z" stroke={mainColor} strokeWidth="2" />
      <Circle cx="16" cy="16" r="5" stroke={mainColor} strokeWidth="2" />
      <Path d="M14 16l1.5 1.5 3-3" stroke={mainColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
};
