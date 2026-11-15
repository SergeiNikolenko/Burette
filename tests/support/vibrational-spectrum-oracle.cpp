#include <cmath>
#include <iostream>
#include <iomanip>
#include <vector>
using std::sqrt; using std::log; using std::exp; using std::fabs;
float scaleAndBlur(float x, float peak, float intensity, float scale = 1.0,
                   float shift = 0.0, float fwhm = 0.0)
{
  // return the intensity at point x, from a Gaussian centered at peak
  // with a width of fwhm, scaled by scale and shifted by shift
  float fwhm_to_sigma = 2.0 * sqrt(2.0 * log(2.0));
  float sigma = fwhm / fwhm_to_sigma;

  // x is the absolute position, but we need to scale the peak position
  float scaled_peak = (peak - shift) / scale;

  float delta = x - scaled_peak;
  float exponent = -(delta * delta) / (2 * sigma * sigma);
  float gaussian = exp(exponent);
  return intensity * gaussian;
}

float closestTo(float x, float peak, float intensity, float scale = 1.0,
                float shift = 0.0, float xScale = 1.0)
{
  // return peak intensity if x is closer to the peak than another point
  // scaled by scale and shifted by shift
  float scaled_peak = (peak - shift) / scale;
  float delta = x - scaled_peak;
  // xScale is the reciprocal of the space between points
  // (i.e., used to generate many points in the loop)
  float peak_to_peak = 1.0 / xScale;
  return (fabs(delta) < peak_to_peak / 2.0) ? intensity : 0.0;
}


int main() {
 int ir,n; float scale,offset,fwhm,axisStart,axisEnd;
 std::cin>>ir>>scale>>offset>>fwhm>>axisStart>>axisEnd>>n;
 std::vector<double> frequencies(n), intensities(n);
 for(int i=0;i<n;i++) std::cin>>frequencies[i]>>intensities[i];
 // Same spectra matrices as spectra.cpp; no normalization in molecule storage,
 // setSpectra, changeSpectra or updatePlot before the common summation loop.
 double maxIntensity=0; for(auto v:intensities) if(v>maxIntensity)maxIntensity=v;
 if(ir)maxIntensity=100.0; if(maxIntensity<1)maxIntensity=1;
 float start=std::min(axisStart,axisEnd),end=std::max(axisStart,axisEnd);
 std::cout<<std::setprecision(10);
 for(unsigned int x=round(start);x<round(end);++x){
  float xValue=x,smooth=0,raw=0;
  for(int i=0;i<n;i++){
   float freq=frequencies[i],peak=intensities[i];
   smooth+=scaleAndBlur(xValue,freq,peak,scale,offset,fwhm);
   raw+=closestTo(xValue,freq,peak,scale,offset,1.0);
  }
  if(ir){float trans=1.0f-(smooth/(maxIntensity*1.25));smooth=trans*100.0;
   trans=1.0f-(raw/maxIntensity);raw=trans*100.0;}
  std::cout<<xValue<<" "<<smooth<<" "<<raw<<"\n";
 }
}
