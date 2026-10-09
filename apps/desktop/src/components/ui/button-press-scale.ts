// Original Atlas press scale shared by React and standalone viewer buttons.
export function buttonPressScale(width: number) {
  return width <= 80 ? .96 : width <= 150 ? .97 : width <= 220 ? .98 : width > 600 ? .995 : .985;
}
