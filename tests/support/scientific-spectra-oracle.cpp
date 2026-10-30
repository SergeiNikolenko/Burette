// BSD-3-Clause; pinned Avogadro d250eb3c62a61470b1e0cdf205dcfe26b06f991f.
// See tests/fixtures/quantum/avogadro-spectra-LICENSE.txt.
#include <cmath>
#include <iostream>
#include <iomanip>
#include <vector>
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

int main(){
 int nmr,n;float xScale,scale,offset,fwhm,a,b;
 std::cin>>nmr>>xScale>>scale>>offset>>fwhm>>a>>b>>n;
 std::vector<double> frequencies(n),intensities(n);
 for(int i=0;i<n;i++)std::cin>>frequencies[i]>>intensities[i];
 if(nmr)scale=-scale;
 float start=std::min(a,b),end=std::max(a,b);
 if(start<0)return 2; // Negative ranges use explicit repaired scientific invariants.
 std::cout<<std::setprecision(10);
 for(unsigned int x=round(start*xScale);x<round(end*xScale);++x){
  float position=static_cast<float>(x)/xScale,smooth=0,raw=0;
  for(int i=0;i<n;i++){float freq=frequencies[i],peak=intensities[i];
   smooth+=scaleAndBlur(position,freq,peak,scale,offset,fwhm);
   raw+=closestTo(position,freq,peak,scale,offset,xScale);}
  std::cout<<position<<" "<<smooth<<" "<<raw<<"\n";
 }
}
