#include <algorithm>
#include <array>
#include <cctype>
#include <cerrno>
#include <charconv>
#include <cstdint>
#include <cstring>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <memory>
#include <cmath>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <tuple>
#include <vector>

#include <fcntl.h>
#include <unistd.h>

#include "ifcpp/IFC4X3/EntityFactory.h"
#include "ifcpp/IFC4X3/include/IfcCartesianPointList3D.h"
#include "ifcpp/IFC4X3/include/IfcIdentifier.h"
#include "ifcpp/IFC4X3/include/IfcLabel.h"
#include "ifcpp/IFC4X3/include/IfcLengthMeasure.h"
#include "ifcpp/IFC4X3/include/IfcPositiveInteger.h"
#include "ifcpp/IFC4X3/include/IfcGloballyUniqueId.h"
#include "ifcpp/IFC4X3/include/IfcProduct.h"
#include "ifcpp/IFC4X3/include/IfcProductRepresentation.h"
#include "ifcpp/IFC4X3/include/IfcPropertySet.h"
#include "ifcpp/IFC4X3/include/IfcPropertySingleValue.h"
#include "ifcpp/IFC4X3/include/IfcRelDefinesByProperties.h"
#include "ifcpp/IFC4X3/include/IfcRepresentation.h"
#include "ifcpp/IFC4X3/include/IfcTriangulatedFaceSet.h"
#include "ifcpp/model/BuildingModel.h"
#include "ifcpp/model/UnitConverter.h"
#include "ifcpp/reader/ReaderSTEP.h"

namespace fs = std::filesystem;
using namespace IFC4X3;

constexpr const char* kCommit = "7b80900197b1f17cdafe47e0548e8eec056a3c9c";
const std::string kEmpty;

struct Sha256 {
  std::array<uint32_t, 8> h{0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19};
  std::array<uint8_t, 64> block{};
  uint64_t bytes = 0;
  size_t used = 0;
  static uint32_t rotr(uint32_t x, unsigned n) { return (x >> n) | (x << (32 - n)); }
  void compress() {
    static constexpr uint32_t k[64] = {
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2};
    uint32_t w[64];
    for (int i=0;i<16;i++) w[i]=(uint32_t(block[i*4])<<24)|(uint32_t(block[i*4+1])<<16)|(uint32_t(block[i*4+2])<<8)|block[i*4+3];
    for (int i=16;i<64;i++) { uint32_t a=rotr(w[i-15],7)^rotr(w[i-15],18)^(w[i-15]>>3); uint32_t b=rotr(w[i-2],17)^rotr(w[i-2],19)^(w[i-2]>>10); w[i]=w[i-16]+a+w[i-7]+b; }
    auto v=h;
    for(int i=0;i<64;i++){ uint32_t s1=rotr(v[4],6)^rotr(v[4],11)^rotr(v[4],25); uint32_t ch=(v[4]&v[5])^(~v[4]&v[6]); uint32_t t1=v[7]+s1+ch+k[i]+w[i]; uint32_t s0=rotr(v[0],2)^rotr(v[0],13)^rotr(v[0],22); uint32_t maj=(v[0]&v[1])^(v[0]&v[2])^(v[1]&v[2]); uint32_t t2=s0+maj; v={t1+t2,v[0],v[1],v[2],v[3]+t1,v[4],v[5],v[6]}; }
    for(int i=0;i<8;i++) h[i]+=v[i];
  }
  void add(const uint8_t* data,size_t n){ bytes+=n; while(n){ size_t take=std::min(n,64-used); std::memcpy(block.data()+used,data,take); used+=take; data+=take; n-=take; if(used==64){compress();used=0;} } }
  std::string finish(){ uint64_t bits=bytes*8; block[used++]=0x80; if(used>56){ while(used<64)block[used++]=0; compress();used=0;} while(used<56)block[used++]=0; for(int i=7;i>=0;i--)block[used++]=uint8_t(bits>>(i*8)); compress(); std::ostringstream out; out<<std::hex<<std::setfill('0'); for(auto x:h)out<<std::setw(8)<<x; return out.str(); }
};

static std::string sha256(const std::vector<uint8_t>& bytes){ Sha256 h; h.add(bytes.data(),bytes.size()); return h.finish(); }
static std::string sha256(const std::string& s){ Sha256 h; h.add(reinterpret_cast<const uint8_t*>(s.data()),s.size()); return h.finish(); }
static std::string upper(std::string s){ std::transform(s.begin(),s.end(),s.begin(),[](unsigned char c){return char(std::toupper(c));}); return s; }

class BoundedText {
 public:
  explicit BoundedText(size_t limit):limit_(limit){value_.reserve(std::min(limit,size_t(4096)));}
  void append(std::string_view text){if(text.size()>limit_-value_.size())throw std::runtime_error("output exceeds --max-output-bytes");value_.append(text);}
  void character(char value){if(value_.size()==limit_)throw std::runtime_error("output exceeds --max-output-bytes");value_.push_back(value);}
  template<class T> void integer(T value){char buffer[32];auto result=std::to_chars(buffer,buffer+sizeof(buffer),value);if(result.ec!=std::errc())throw std::runtime_error("integer serialization failed");append({buffer,size_t(result.ptr-buffer)});}
  void real(float value){char buffer[64];int count=std::snprintf(buffer,sizeof(buffer),"%.*g",std::numeric_limits<float>::max_digits10,double(value));if(count<0||size_t(count)>=sizeof(buffer))throw std::runtime_error("float serialization failed");append({buffer,size_t(count)});}
  void real(double value){char buffer[64];int count=std::snprintf(buffer,sizeof(buffer),"%.*g",std::numeric_limits<double>::max_digits10,value);if(count<0||size_t(count)>=sizeof(buffer))throw std::runtime_error("double serialization failed");append({buffer,size_t(count)});}
  void quoted(const std::string& text){character('"');for(unsigned char c:text){switch(c){case '"':append("\\\"");break;case '\\':append("\\\\");break;case '\n':append("\\n");break;case '\r':append("\\r");break;case '\t':append("\\t");break;default:if(c<0x20){char buffer[7];std::snprintf(buffer,sizeof(buffer),"\\u%04x",unsigned(c));append(buffer);}else character(char(c));}}character('"');}
  void pad4(){while(value_.size()%4)character(' ');}
  std::string take(){return std::move(value_);}
 private:
  size_t limit_;
  std::string value_;
};

template<class T> static void append(std::vector<uint8_t>& out,const T& v){ const auto* p=reinterpret_cast<const uint8_t*>(&v); out.insert(out.end(),p,p+sizeof(T)); }
static void append_u32(std::vector<uint8_t>& out,uint32_t v){ append(out,v); }
static void align4(std::vector<uint8_t>& out){ while(out.size()%4)out.push_back(0); }

struct Property { int groupId; int propertyId; std::string group,name,value,unit; };
struct Mesh { int expressId; std::string nodeId; std::vector<float> positions; std::vector<uint32_t> indices; };
struct Element { int expressId; std::string globalId,type,name; std::vector<Mesh> meshes; std::vector<Property> properties; };
struct BufferRef { size_t positionOffset,positionBytes,indexOffset,indexBytes; uint32_t count; std::array<float,3> min,max; };
struct Limits {
  uint64_t entities = 2'000'000;
  uint64_t vertices = 10'000'000;
  uint64_t indices = 30'000'000;
  uint64_t properties = 2'000'000;
  uint64_t outputBytes = 1'000'000'000;
};

static size_t checked_add(size_t left,size_t right,size_t limit,const char* message){
  if(right>limit||left>limit-right)throw std::runtime_error(message);
  return left+right;
}
static size_t checked_mul(size_t left,size_t right,size_t limit,const char* message){
  if(left&&right>limit/left)throw std::runtime_error(message);
  return left*right;
}
static uint32_t checked_u32(size_t value,const char* message){if(value>std::numeric_limits<uint32_t>::max())throw std::runtime_error(message);return uint32_t(value);}

static uint64_t count_step_entities(const std::string& raw,uint64_t limit){
  enum class State{normal,string,comment};State state=State::normal;uint64_t count=0;
  for(size_t i=0;i<raw.size();++i){
    if(state==State::string){if(raw[i]=='\''&&i+1<raw.size()&&raw[i+1]=='\''){++i;continue;}if(raw[i]=='\'')state=State::normal;continue;}
    if(state==State::comment){if(raw[i]=='*'&&i+1<raw.size()&&raw[i+1]=='/'){++i;state=State::normal;}continue;}
    if(raw[i]=='\''){state=State::string;continue;}if(raw[i]=='/'&&i+1<raw.size()&&raw[i+1]=='*'){++i;state=State::comment;continue;}
    if(raw[i]!='#')continue;size_t p=i+1;if(p>=raw.size()||!std::isdigit(static_cast<unsigned char>(raw[p])))continue;while(p<raw.size()&&std::isdigit(static_cast<unsigned char>(raw[p])))++p;while(p<raw.size()&&std::isspace(static_cast<unsigned char>(raw[p])))++p;if(p<raw.size()&&raw[p]=='='){if(count==limit)throw std::runtime_error("entity count exceeds --max-entities");++count;}
  }
  return count;
}

struct ExtractionBudget{size_t properties=0;size_t metadata=0;size_t retained=0;};
static size_t json_character_size(unsigned char c){return c<0x20?6:((c=='"'||c=='\\')?2:1);}
static size_t json_escaped_size(const std::string& text,size_t limit){size_t result=2;for(unsigned char c:text)result=checked_add(result,json_character_size(c),limit,"metadata exceeds --max-output-bytes");return result;}
static void account_retained(ExtractionBudget& budget,size_t bytes,const Limits& limits){budget.retained=checked_add(budget.retained,bytes,size_t(limits.outputBytes),"derivative allocation exceeds --max-output-bytes");}
static void account_metadata(ExtractionBudget& budget,const std::string& text,const Limits& limits){size_t bytes=json_escaped_size(text,size_t(limits.outputBytes));budget.metadata=checked_add(budget.metadata,bytes,size_t(limits.outputBytes),"metadata exceeds --max-output-bytes");account_retained(budget,bytes,limits);}
static std::string label_step(const shared_ptr<IfcLabel>& label,ExtractionBudget& budget,const Limits& limits){size_t rawSize=12,jsonSize=14;for(unsigned char c:label->m_value){rawSize=checked_add(rawSize,c=='\''?2:1,size_t(limits.outputBytes),"metadata exceeds --max-output-bytes");jsonSize=checked_add(jsonSize,json_character_size(c)*(c=='\''?2:1),size_t(limits.outputBytes),"metadata exceeds --max-output-bytes");}budget.metadata=checked_add(budget.metadata,jsonSize,size_t(limits.outputBytes),"metadata exceeds --max-output-bytes");account_retained(budget,jsonSize,limits);std::string value;value.reserve(rawSize);value="IFCLABEL('";for(char c:label->m_value){value.push_back(c);if(c=='\'')value.push_back('\'');}value.append("')");return value;}

static std::vector<Property> properties(const shared_ptr<IfcProduct>& product,const Limits& limits,ExtractionBudget& budget){
  std::vector<Property> result;
  for(const auto& weak:product->m_IsDefinedBy_inverse){
    auto rel=weak.lock(); if(!rel)continue;
    auto definition=rel->m_RelatingPropertyDefinition;
    auto set=dynamic_pointer_cast<IfcPropertySet>(definition);
    if(!set){auto entity=dynamic_pointer_cast<BuildingEntity>(definition);throw std::runtime_error("unsupported property definition #"+std::to_string(entity?entity->m_tag:0)+" "+(entity?upper(EntityFactory::getStringForClassID(entity->classID())):"UNKNOWN"));}
    for(const auto& raw:set->m_HasProperties){
      budget.properties=checked_add(budget.properties,1,size_t(limits.properties),"property count exceeds --max-properties");
      account_retained(budget,sizeof(Property),limits);
      auto value=dynamic_pointer_cast<IfcPropertySingleValue>(raw); if(!value) throw std::runtime_error("unsupported property #"+std::to_string(raw->m_tag)+" "+upper(EntityFactory::getStringForClassID(raw->classID())));
      auto label=dynamic_pointer_cast<IfcLabel>(value->m_NominalValue);if(!label)throw std::runtime_error("unsupported property value #"+std::to_string(raw->m_tag));if(value->m_Unit)throw std::runtime_error("unsupported property unit #"+std::to_string(raw->m_tag));
      const std::string& groupSource=set->m_Name?set->m_Name->m_value:kEmpty;const std::string& nameSource=value->m_Name?value->m_Name->m_value:kEmpty;account_metadata(budget,groupSource,limits);account_metadata(budget,nameSource,limits);auto nominal=label_step(label,budget,limits);result.push_back({set->m_tag,value->m_tag,groupSource,nameSource,std::move(nominal),""});
    }
  }
  std::sort(result.begin(),result.end(),[](const auto&a,const auto&b){return std::tie(a.groupId,a.propertyId)<std::tie(b.groupId,b.propertyId);});
  return result;
}

static std::vector<Element> extract(const shared_ptr<BuildingModel>& model,double factor,const Limits& limits){
  std::vector<Element> elements;
  size_t totalVertices=0,totalIndices=0;ExtractionBudget budget;
  for(const auto& [id,entity]:model->getMapIfcEntities()){
    auto product=dynamic_pointer_cast<IfcProduct>(entity); if(!product||!product->m_Representation)continue;
    if(product->m_ObjectPlacement) throw std::runtime_error("unsupported object placement on product #"+std::to_string(id));
    account_retained(budget,sizeof(Element),limits);const std::string& globalSource=product->m_GlobalId?product->m_GlobalId->m_value:kEmpty;const std::string& nameSource=product->m_Name?product->m_Name->m_value:kEmpty;account_metadata(budget,globalSource,limits);account_metadata(budget,nameSource,limits);std::string type=upper(EntityFactory::getStringForClassID(product->classID()));account_metadata(budget,type,limits);Element e{id,globalSource,std::move(type),nameSource,{},properties(product,limits,budget)};
    for(const auto& rep:product->m_Representation->m_Representations){
      if(!rep)throw std::runtime_error("null representation on product #"+std::to_string(id));
      for(const auto& raw:rep->m_Items){
        auto face=dynamic_pointer_cast<IfcTriangulatedFaceSet>(raw);
        if(!face)throw std::runtime_error("unsupported representation item #"+std::to_string(raw->m_tag)+" "+upper(EntityFactory::getStringForClassID(raw->classID())));
        auto points=face->m_Coordinates; if(!points)throw std::runtime_error("missing coordinates on item #"+std::to_string(raw->m_tag));
        totalVertices=checked_add(totalVertices,points->m_CoordList.size(),size_t(limits.vertices),"vertex count exceeds --max-vertices");
        size_t itemIndices=checked_mul(face->m_CoordIndex.size(),size_t(3),size_t(limits.indices),"index count exceeds --max-indices");
        totalIndices=checked_add(totalIndices,itemIndices,size_t(limits.indices),"index count exceeds --max-indices");
        account_retained(budget,sizeof(Mesh)+64,limits);size_t componentLimit=checked_mul(size_t(limits.vertices),size_t(3),std::numeric_limits<size_t>::max(),"vertex component limit overflow");size_t componentCount=checked_mul(points->m_CoordList.size(),size_t(3),componentLimit,"vertex component count overflow");size_t positionBytes=checked_mul(componentCount,sizeof(float),size_t(limits.outputBytes),"derivative allocation exceeds --max-output-bytes");size_t indexBytes=checked_mul(itemIndices,sizeof(uint32_t),size_t(limits.outputBytes),"derivative allocation exceeds --max-output-bytes");account_retained(budget,checked_add(positionBytes,indexBytes,size_t(limits.outputBytes),"derivative allocation exceeds --max-output-bytes"),limits);Mesh mesh{raw->m_tag,"ifc:"+std::to_string(id)+":item:"+std::to_string(raw->m_tag)};
        mesh.positions.reserve(componentCount);mesh.indices.reserve(itemIndices);
        for(const auto& p:points->m_CoordList){ if(p.size()!=3||!p[0]||!p[1]||!p[2])throw std::runtime_error("invalid 3D coordinate on item #"+std::to_string(raw->m_tag)); for(const auto& n:p){double scaled=n->m_value*factor;if(!std::isfinite(n->m_value)||!std::isfinite(scaled)||scaled>std::numeric_limits<float>::max()||scaled<-std::numeric_limits<float>::max())throw std::runtime_error("scaled coordinate is outside finite float range on item #"+std::to_string(raw->m_tag));float value=static_cast<float>(scaled);if(!std::isfinite(value))throw std::runtime_error("scaled coordinate is outside finite float range on item #"+std::to_string(raw->m_tag));mesh.positions.push_back(value);} }
        for(const auto& tri:face->m_CoordIndex){ if(tri.size()!=3)throw std::runtime_error("non-triangle index on item #"+std::to_string(raw->m_tag)); for(const auto& n:tri){ if(!n||n->m_value<1||size_t(n->m_value)>points->m_CoordList.size())throw std::runtime_error("invalid index on item #"+std::to_string(raw->m_tag)); mesh.indices.push_back(checked_u32(size_t(n->m_value-1),"index exceeds GLB uint32 range")); } }
        if(mesh.indices.empty())throw std::runtime_error("empty triangulation on item #"+std::to_string(raw->m_tag));
        e.meshes.push_back(std::move(mesh));
      }
    }
    if(e.meshes.empty())throw std::runtime_error("represented product #"+std::to_string(id)+" produced no meshes");
    elements.push_back(std::move(e));
  }
  std::sort(elements.begin(),elements.end(),[](const auto&a,const auto&b){return a.expressId<b.expressId;});
  return elements;
}

static std::vector<uint8_t> make_glb(const std::vector<Element>& elements,size_t outputLimit){
  std::vector<uint8_t> bin; std::vector<BufferRef> refs;
  size_t binaryBytes=0,meshCount=0;
  for(const auto& e:elements)for(const auto& mesh:e.meshes){binaryBytes=checked_add(binaryBytes,3,size_t(outputLimit),"output exceeds --max-output-bytes");binaryBytes-=binaryBytes%4;binaryBytes=checked_add(binaryBytes,checked_mul(mesh.positions.size(),sizeof(float),size_t(outputLimit),"output exceeds --max-output-bytes"),size_t(outputLimit),"output exceeds --max-output-bytes");binaryBytes=checked_add(binaryBytes,3,size_t(outputLimit),"output exceeds --max-output-bytes");binaryBytes-=binaryBytes%4;binaryBytes=checked_add(binaryBytes,checked_mul(mesh.indices.size(),sizeof(uint32_t),size_t(outputLimit),"output exceeds --max-output-bytes"),size_t(outputLimit),"output exceeds --max-output-bytes");meshCount=checked_add(meshCount,1,std::numeric_limits<uint32_t>::max(),"mesh count exceeds GLB uint32 range");}
  bin.reserve(binaryBytes);refs.reserve(meshCount);
  for(const auto& e:elements)for(const auto& mesh:e.meshes){
    align4(bin); BufferRef r{}; r.positionOffset=bin.size(); r.positionBytes=checked_mul(mesh.positions.size(),sizeof(float),outputLimit,"output exceeds --max-output-bytes"); r.count=checked_u32(mesh.positions.size()/3,"vertex count exceeds GLB uint32 range"); r.min={std::numeric_limits<float>::max(),std::numeric_limits<float>::max(),std::numeric_limits<float>::max()}; r.max={-r.min[0],-r.min[1],-r.min[2]};
    for(size_t i=0;i<mesh.positions.size();i++){ append(bin,mesh.positions[i]); r.min[i%3]=std::min(r.min[i%3],mesh.positions[i]); r.max[i%3]=std::max(r.max[i%3],mesh.positions[i]); }
    align4(bin); r.indexOffset=bin.size(); r.indexBytes=checked_mul(mesh.indices.size(),sizeof(uint32_t),outputLimit,"output exceeds --max-output-bytes"); for(auto x:mesh.indices)append(bin,x); refs.push_back(r);
  }
  size_t fixedBytes=checked_add(size_t(28),bin.size(),outputLimit,"output exceeds --max-output-bytes");BoundedText j(outputLimit-fixedBytes);j.append("{\"accessors\":[");size_t ri=0;for(const auto&r:refs){if(ri)j.character(',');j.append("{\"bufferView\":");j.integer(ri*2);j.append(",\"componentType\":5126,\"count\":");j.integer(r.count);j.append(",\"max\":[");j.real(r.max[0]);j.character(',');j.real(r.max[1]);j.character(',');j.real(r.max[2]);j.append("],\"min\":[");j.real(r.min[0]);j.character(',');j.real(r.min[1]);j.character(',');j.real(r.min[2]);j.append("],\"type\":\"VEC3\"},{\"bufferView\":");j.integer(ri*2+1);j.append(",\"componentType\":5125,\"count\":");j.integer(r.indexBytes/4);j.append(",\"type\":\"SCALAR\"}");++ri;}j.append("],\"asset\":{\"generator\":\"1HK IfcPlusPlus derivative\",\"version\":\"2.0\"},\"bufferViews\":[");for(size_t i=0;i<refs.size();++i){if(i)j.character(',');const auto&r=refs[i];j.append("{\"buffer\":0,\"byteLength\":");j.integer(r.positionBytes);j.append(",\"byteOffset\":");j.integer(r.positionOffset);j.append(",\"target\":34962},{\"buffer\":0,\"byteLength\":");j.integer(r.indexBytes);j.append(",\"byteOffset\":");j.integer(r.indexOffset);j.append(",\"target\":34963}");}j.append("],\"buffers\":[{\"byteLength\":");j.integer(bin.size());j.append("}],\"meshes\":[");ri=0;for(const auto&e:elements)for(const auto&m:e.meshes){if(ri)j.character(',');j.append("{\"primitives\":[{\"attributes\":{\"POSITION\":");j.integer(ri*2);j.append("},\"indices\":");j.integer(ri*2+1);j.append(",\"mode\":4}]}");++ri;}j.append("],\"nodes\":[");ri=0;for(const auto&e:elements)for(const auto&m:e.meshes){if(ri)j.character(',');j.append("{\"extras\":{\"expressId\":");j.integer(e.expressId);j.append(",\"nodeId\":");j.quoted(m.nodeId);j.append("},\"mesh\":");j.integer(ri);j.append(",\"name\":");j.quoted(m.nodeId);j.character('}');++ri;}j.append("],\"scene\":0,\"scenes\":[{\"nodes\":[");for(size_t i=0;i<ri;++i){if(i)j.character(',');j.integer(i);}j.append("]}]}");j.pad4();std::string js=j.take();align4(bin);
  size_t total=12;total=checked_add(total,8,outputLimit,"output exceeds --max-output-bytes");total=checked_add(total,js.size(),outputLimit,"output exceeds --max-output-bytes");total=checked_add(total,8,outputLimit,"output exceeds --max-output-bytes");total=checked_add(total,bin.size(),outputLimit,"output exceeds --max-output-bytes");checked_u32(total,"GLB exceeds uint32 chunk range");
  std::vector<uint8_t> out;out.reserve(total); append_u32(out,0x46546c67);append_u32(out,2);append_u32(out,checked_u32(total,"GLB exceeds uint32 chunk range"));append_u32(out,checked_u32(js.size(),"GLB JSON chunk exceeds uint32 range"));append_u32(out,0x4e4f534a);out.insert(out.end(),js.begin(),js.end());append_u32(out,checked_u32(bin.size(),"GLB BIN chunk exceeds uint32 range"));append_u32(out,0x004e4942);out.insert(out.end(),bin.begin(),bin.end());return out;
}

static std::string manifest(const std::string& fileId,const std::string& sourceHash,const std::string& geometryHash,double factor,const std::vector<Element>& elements,size_t outputLimit){
  BoundedText o(outputLimit);o.append("{\"elements\":[");for(size_t i=0;i<elements.size();++i){if(i)o.character(',');const auto&e=elements[i];o.append("{\"expressId\":");o.integer(e.expressId);o.append(",\"globalId\":");o.quoted(e.globalId);o.append(",\"meshes\":[");for(size_t k=0;k<e.meshes.size();++k){if(k)o.character(',');o.append("{\"itemId\":");o.integer(e.meshes[k].expressId);o.append(",\"nodeId\":");o.quoted(e.meshes[k].nodeId);o.append(",\"primitiveIndices\":[0]}");}o.append("],\"name\":");o.quoted(e.name);o.append(",\"properties\":[");for(size_t k=0;k<e.properties.size();++k){if(k)o.character(',');const auto&p=e.properties[k];o.append("{\"group\":");o.quoted(p.group);o.append(",\"groupId\":");o.integer(p.groupId);o.append(",\"name\":");o.quoted(p.name);o.append(",\"propertyId\":");o.integer(p.propertyId);o.append(",\"unit\":");o.quoted(p.unit);o.append(",\"value\":");o.quoted(p.value);o.character('}');}o.append("],\"type\":");o.quoted(e.type);o.character('}');}o.append("],\"engine\":{\"commit\":");o.quoted(kCommit);o.append(",\"name\":\"IfcPlusPlus\"},\"geometry\":{\"sha256\":");o.quoted(geometryHash);o.append("},\"schemaVersion\":1,\"source\":{\"fileId\":");o.quoted(fileId);o.append(",\"sha256\":");o.quoted(sourceHash);o.append("},\"status\":\"complete\",\"units\":{\"lengthToMeters\":");o.real(factor);o.append("}}\n");return o.take();
}

static fs::path normalized(const fs::path& p){ return fs::weakly_canonical(p.parent_path())/p.filename(); }
static void publish(const fs::path& path,const std::vector<uint8_t>& data){ std::string pattern=(path.parent_path()/("."+path.filename().string()+".tmp.XXXXXX")).string(); std::vector<char> temp(pattern.begin(),pattern.end());temp.push_back(0);int fd=mkstemp(temp.data());if(fd<0)throw std::runtime_error("cannot create output temp");fs::path tmp=temp.data();try{size_t done=0;while(done<data.size()){ssize_t n=write(fd,data.data()+done,data.size()-done);if(n<0)throw std::runtime_error("cannot write output temp");done+=size_t(n);}if(fsync(fd)||close(fd)){fd=-1;throw std::runtime_error("cannot sync output temp");}fd=-1;if(link(tmp.c_str(),path.c_str()))throw std::runtime_error(errno==EEXIST?"target already exists":"cannot publish target");fs::remove(tmp);}catch(...){if(fd>=0)close(fd);fs::remove(tmp);throw;}}

int main(int argc,char**argv){
  try{
    if(argc<6)throw std::runtime_error("usage: converter source.ifc manifest.json geometry.glb --source-file-id ID [--max-input-bytes N] [--max-properties N]");
    fs::path source=argv[1],manifestPath=argv[2],glbPath=argv[3];std::string fileId;uintmax_t limit=512ull*1024*1024;Limits limits;
    for(int i=4;i<argc;i++){std::string a=argv[i];if(a=="--source-file-id"&&i+1<argc)fileId=argv[++i];else if(a=="--max-input-bytes"&&i+1<argc)limit=std::stoull(argv[++i]);else if(a=="--max-entities"&&i+1<argc)limits.entities=std::stoull(argv[++i]);else if(a=="--max-vertices"&&i+1<argc)limits.vertices=std::stoull(argv[++i]);else if(a=="--max-indices"&&i+1<argc)limits.indices=std::stoull(argv[++i]);else if(a=="--max-properties"&&i+1<argc)limits.properties=std::stoull(argv[++i]);else if(a=="--max-output-bytes"&&i+1<argc)limits.outputBytes=std::stoull(argv[++i]);else throw std::runtime_error("unknown or incomplete option: "+a);}
    if(fileId.empty())throw std::runtime_error("--source-file-id is required");
    constexpr uint64_t glbMaximum=std::numeric_limits<uint32_t>::max();if(limits.vertices>glbMaximum)throw std::runtime_error("--max-vertices exceeds GLB uint32 maximum");if(limits.indices>glbMaximum)throw std::runtime_error("--max-indices exceeds GLB uint32 maximum");if(limits.outputBytes>glbMaximum)throw std::runtime_error("--max-output-bytes exceeds GLB uint32 maximum");
    if(normalized(source)==normalized(manifestPath)||normalized(source)==normalized(glbPath)||normalized(manifestPath)==normalized(glbPath))throw std::runtime_error("source and target paths must differ");
    auto size=fs::file_size(source);if(size>limit)throw std::runtime_error("input exceeds --max-input-bytes");
    std::ifstream in(source,std::ios::binary);if(!in)throw std::runtime_error("cannot open source");std::string raw((std::istreambuf_iterator<char>(in)),{});if(raw.size()!=size)throw std::runtime_error("source changed while reading");count_step_entities(raw,limits.entities);
    auto model=make_shared<BuildingModel>();ReaderSTEP reader;std::vector<std::string> errors;reader.setMessageCallBack([&](shared_ptr<StatusCallback::Message> m){if(m&&m->m_message_type>=StatusCallback::MESSAGE_TYPE_ERROR)errors.push_back(m->m_message_text);});std::istringstream stream(raw);reader.loadModelFromStream(stream,std::streampos(raw.size()),model);if(!errors.empty())throw std::runtime_error("IFC parse failed: "+errors.front());
    if(model->getMapIfcEntities().size()>limits.entities)throw std::runtime_error("entity count exceeds --max-entities");double factor=model->getUnitConverter()->getLengthInMeterFactor();if(!std::isfinite(factor)||factor<=0)throw std::runtime_error("invalid model length unit factor");auto elements=extract(model,factor,limits);if(elements.empty())throw std::runtime_error("no represented products");auto glb=make_glb(elements,size_t(limits.outputBytes));auto text=manifest(fileId,sha256(raw),sha256(glb),factor,elements,size_t(limits.outputBytes));std::vector<uint8_t> manifestBytes(text.begin(),text.end());
    publish(glbPath,glb);try{publish(manifestPath,manifestBytes);}catch(...){fs::remove(glbPath);throw;}
    return 0;
  }catch(const std::exception&e){std::cerr<<e.what()<<'\n';return 1;}
}
