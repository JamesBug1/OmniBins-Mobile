import React from 'react';
import { View, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const PRIMARY_GREEN = '#00a63e';

const GlobalStatusBar = () => {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ backgroundColor: PRIMARY_GREEN }}>
      <StatusBar
        barStyle="light-content"
        backgroundColor="transparent"
        translucent={true}
      />
      {/* Spacer for the system status bar area */}
      <View style={{ height: insets.top }} />
    </View>
  );
};

export default GlobalStatusBar;
