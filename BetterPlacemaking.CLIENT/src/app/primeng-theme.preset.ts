import Aura from '@primeuix/themes/aura';
import { definePreset } from '@primeuix/themes';

const BetterPlacemakingPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: '{cyan.50}',
      100: '{cyan.100}',
      200: '{cyan.200}',
      300: '{cyan.300}',
      400: '{cyan.400}',
      500: '{cyan.500}',
      600: '{cyan.600}',
      700: '{cyan.700}',
      800: '{cyan.800}',
      900: '{cyan.900}',
      950: '{cyan.950}'
    }
  },
  colorScheme: {
    light: {
      accent: {
        color: '{cyan.500}',
        background: '{cyan.100}',
      },
      tertiary: {
        color: '{gray.700}',
        background: '{gray.50}',
      }
    },
    dark: {
      accent: {
        color: '{cyan.200}',
        background: '{cyan.950}',
      },
      tertiary: {
        color: '{gray.300}',
        background: '{gray.700}',
      }
    }
  }
});

export default BetterPlacemakingPreset;
