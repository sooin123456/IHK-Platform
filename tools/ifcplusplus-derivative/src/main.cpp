#include <algorithm>
#include <array>
#include <cctype>
#include <cerrno>
#include <cstdint>
#include <cstring>
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
static std::string json(const std::string& s){ std::ostringstream o; o<<'"'; for(unsigned char c:s){ switch(c){case '"':o<<"\\\"";break;case '\\':o<<"\\\\";break;case '\n':o<<"\\n";break;case '\r':o<<"\\r";break;case '\t':o<<"\\t";break;default: if(c<0x20)o<<"\\u"<<std::hex<<std::setw(4)<<std::setfill('0')<<int(c)<<std::dec; else o<<c;} } o<<'"'; return o.str(); }
static std::string upper(std::string s){ std::transform(s.begin(),s.end(),s.begin(),[](unsigned char c){return char(std::toupper(c));}); return s; }
static std::string step(const shared_ptr<BuildingObject>& x){ if(!x)return ""; std::stringstream s; x->getStepParameter(s,true,15); return s.str(); }

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
  uint64_t count=0;
  for(size_t i=0;i<raw.size();++i){
    if(raw[i]!='#')continue;size_t p=i+1;if(p>=raw.size()||!std::isdigit(static_cast<unsigned char>(raw[p])))continue;while(p<raw.size()&&std::isdigit(static_cast<unsigned char>(raw[p])))++p;while(p<raw.size()&&std::isspace(static_cast<unsigned char>(raw[p])))++p;if(p<raw.size()&&raw[p]=='='){if(count==limit)throw std::runtime_error("entity count exceeds --max-entities");++count;}
  }
  return count;
}

static std::vector<Property> properties(const shared_ptr<IfcProduct>& product){
  std::vector<Property> result;
  for(const auto& weak:product->m_IsDefinedBy_inverse){
    auto rel=weak.lock(); if(!rel)continue;
    auto definition=rel->m_RelatingPropertyDefinition;
    auto set=dynamic_pointer_cast<IfcPropertySet>(definition);
    if(!set){auto entity=dynamic_pointer_cast<BuildingEntity>(definition);throw std::runtime_error("unsupported property definition #"+std::to_string(entity?entity->m_tag:0)+" "+(entity?upper(EntityFactory::getStringForClassID(entity->classID())):"UNKNOWN"));}
    for(const auto& raw:set->m_HasProperties){
      auto value=dynamic_pointer_cast<IfcPropertySingleValue>(raw); if(!value) throw std::runtime_error("unsupported property #"+std::to_string(raw->m_tag)+" "+upper(EntityFactory::getStringForClassID(raw->classID())));
      result.push_back({set->m_tag,value->m_tag,set->m_Name?set->m_Name->m_value:"",value->m_Name?value->m_Name->m_value:"",step(value->m_NominalValue),step(value->m_Unit)});
    }
  }
  std::sort(result.begin(),result.end(),[](const auto&a,const auto&b){return std::tie(a.groupId,a.propertyId)<std::tie(b.groupId,b.propertyId);});
  return result;
}

static std::vector<Element> extract(const shared_ptr<BuildingModel>& model,double factor,const Limits& limits){
  std::vector<Element> elements;
  size_t totalVertices=0,totalIndices=0;
  for(const auto& [id,entity]:model->getMapIfcEntities()){
    auto product=dynamic_pointer_cast<IfcProduct>(entity); if(!product||!product->m_Representation)continue;
    if(product->m_ObjectPlacement) throw std::runtime_error("unsupported object placement on product #"+std::to_string(id));
    Element e{id,product->m_GlobalId?product->m_GlobalId->m_value:"",upper(EntityFactory::getStringForClassID(product->classID())),product->m_Name?product->m_Name->m_value:"",{},properties(product)};
    for(const auto& rep:product->m_Representation->m_Representations){
      if(!rep)throw std::runtime_error("null representation on product #"+std::to_string(id));
      for(const auto& raw:rep->m_Items){
        auto face=dynamic_pointer_cast<IfcTriangulatedFaceSet>(raw);
        if(!face)throw std::runtime_error("unsupported representation item #"+std::to_string(raw->m_tag)+" "+upper(EntityFactory::getStringForClassID(raw->classID())));
        auto points=face->m_Coordinates; if(!points)throw std::runtime_error("missing coordinates on item #"+std::to_string(raw->m_tag));
        totalVertices=checked_add(totalVertices,points->m_CoordList.size(),size_t(limits.vertices),"vertex count exceeds --max-vertices");
        size_t itemIndices=checked_mul(face->m_CoordIndex.size(),size_t(3),size_t(limits.indices),"index count exceeds --max-indices");
        totalIndices=checked_add(totalIndices,itemIndices,size_t(limits.indices),"index count exceeds --max-indices");
        Mesh mesh{raw->m_tag,"ifc:"+std::to_string(id)+":item:"+std::to_string(raw->m_tag)};
        size_t componentLimit=checked_mul(size_t(limits.vertices),size_t(3),std::numeric_limits<size_t>::max(),"vertex component limit overflow");mesh.positions.reserve(checked_mul(points->m_CoordList.size(),size_t(3),componentLimit,"vertex component count overflow"));mesh.indices.reserve(itemIndices);
        for(const auto& p:points->m_CoordList){ if(p.size()!=3||!p[0]||!p[1]||!p[2])throw std::runtime_error("invalid 3D coordinate on item #"+std::to_string(raw->m_tag)); for(const auto& n:p){double scaled=n->m_value*factor;if(!std::isfinite(n->m_value)||!std::isfinite(scaled)||scaled>std::numeric_limits<float>::max()||scaled<-std::numeric_limits<float>::max())throw std::runtime_error("scaled coordinate is outside finite float range on item #"+std::to_string(raw->m_tag));float value=static_cast<float>(scaled);if(!std::isfinite(value))throw std::runtime_error("scaled coordinate is outside finite float range on item #"+std::to_string(raw->m_tag));mesh.positions.push_back(value);} }
        for(const auto& tri:face->m_CoordIndex){ if(tri.size()!=3)throw std::runtime_error("non-triangle index on item #"+std::to_string(raw->m_tag)); for(const auto& n:tri){ if(!n||n->m_value<1||size_t(n->m_value)>points->m_CoordList.size())throw std::runtime_error("invalid index on item #"+std::to_string(raw->m_tag)); mesh.indices.push_back(uint32_t(n->m_value-1)); } }
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
  std::ostringstream j;j<<std::setprecision(std::numeric_limits<float>::max_digits10); j<<"{\"accessors\":["; size_t ri=0; for(const auto&r:refs){if(ri)j<<','; j<<"{\"bufferView\":"<<ri*2<<",\"componentType\":5126,\"count\":"<<r.count<<",\"max\":["<<r.max[0]<<','<<r.max[1]<<','<<r.max[2]<<"],\"min\":["<<r.min[0]<<','<<r.min[1]<<','<<r.min[2]<<"],\"type\":\"VEC3\"},{\"bufferView\":"<<ri*2+1<<",\"componentType\":5125,\"count\":"<<r.indexBytes/4<<",\"type\":\"SCALAR\"}";ri++;} j<<"],\"asset\":{\"generator\":\"1HK IfcPlusPlus derivative\",\"version\":\"2.0\"},\"bufferViews\":["; for(size_t i=0;i<refs.size();i++){if(i)j<<',';const auto&r=refs[i];j<<"{\"buffer\":0,\"byteLength\":"<<r.positionBytes<<",\"byteOffset\":"<<r.positionOffset<<",\"target\":34962},{\"buffer\":0,\"byteLength\":"<<r.indexBytes<<",\"byteOffset\":"<<r.indexOffset<<",\"target\":34963}";} j<<"],\"buffers\":[{\"byteLength\":"<<bin.size()<<"}],\"meshes\":["; ri=0;for(const auto&e:elements)for(const auto&m:e.meshes){if(ri)j<<',';j<<"{\"primitives\":[{\"attributes\":{\"POSITION\":"<<ri*2<<"},\"indices\":"<<ri*2+1<<",\"mode\":4}]}";ri++;}j<<"],\"nodes\":[";ri=0;for(const auto&e:elements)for(const auto&m:e.meshes){if(ri)j<<',';j<<"{\"extras\":{\"expressId\":"<<e.expressId<<",\"nodeId\":"<<json(m.nodeId)<<"},\"mesh\":"<<ri<<",\"name\":"<<json(m.nodeId)<<"}";ri++;}j<<"],\"scene\":0,\"scenes\":[{\"nodes\":[";for(size_t i=0;i<ri;i++){if(i)j<<',';j<<i;}j<<"]}]}";
  std::string js=j.str(); while(js.size()%4)js.push_back(' '); align4(bin);
  size_t total=12;total=checked_add(total,8,outputLimit,"output exceeds --max-output-bytes");total=checked_add(total,js.size(),outputLimit,"output exceeds --max-output-bytes");total=checked_add(total,8,outputLimit,"output exceeds --max-output-bytes");total=checked_add(total,bin.size(),outputLimit,"output exceeds --max-output-bytes");checked_u32(total,"GLB exceeds uint32 chunk range");
  std::vector<uint8_t> out;out.reserve(total); append_u32(out,0x46546c67);append_u32(out,2);append_u32(out,checked_u32(total,"GLB exceeds uint32 chunk range"));append_u32(out,checked_u32(js.size(),"GLB JSON chunk exceeds uint32 range"));append_u32(out,0x4e4f534a);out.insert(out.end(),js.begin(),js.end());append_u32(out,checked_u32(bin.size(),"GLB BIN chunk exceeds uint32 range"));append_u32(out,0x004e4942);out.insert(out.end(),bin.begin(),bin.end());return out;
}

static std::string manifest(const std::string& fileId,const std::string& sourceHash,const std::string& geometryHash,double factor,const std::vector<Element>& elements){
  std::ostringstream o; o<<std::setprecision(15)<<"{\"elements\":[";for(size_t i=0;i<elements.size();i++){if(i)o<<',';const auto&e=elements[i];o<<"{\"expressId\":"<<e.expressId<<",\"globalId\":"<<json(e.globalId)<<",\"meshes\":[";for(size_t k=0;k<e.meshes.size();k++){if(k)o<<',';o<<"{\"itemId\":"<<e.meshes[k].expressId<<",\"nodeId\":"<<json(e.meshes[k].nodeId)<<",\"primitiveIndices\":[0]}";}o<<"],\"name\":"<<json(e.name)<<",\"properties\":[";for(size_t k=0;k<e.properties.size();k++){if(k)o<<',';const auto&p=e.properties[k];o<<"{\"group\":"<<json(p.group)<<",\"groupId\":"<<p.groupId<<",\"name\":"<<json(p.name)<<",\"propertyId\":"<<p.propertyId<<",\"unit\":"<<json(p.unit)<<",\"value\":"<<json(p.value)<<"}";}o<<"],\"type\":"<<json(e.type)<<"}";}o<<"],\"engine\":{\"commit\":"<<json(kCommit)<<",\"name\":\"IfcPlusPlus\"},\"geometry\":{\"sha256\":"<<json(geometryHash)<<"},\"schemaVersion\":1,\"source\":{\"fileId\":"<<json(fileId)<<",\"sha256\":"<<json(sourceHash)<<"},\"status\":\"complete\",\"units\":{\"lengthToMeters\":"<<factor<<"}}\n";return o.str();
}

static fs::path normalized(const fs::path& p){ return fs::weakly_canonical(p.parent_path())/p.filename(); }
static void publish(const fs::path& path,const std::vector<uint8_t>& data){ std::string pattern=(path.parent_path()/("."+path.filename().string()+".tmp.XXXXXX")).string(); std::vector<char> temp(pattern.begin(),pattern.end());temp.push_back(0);int fd=mkstemp(temp.data());if(fd<0)throw std::runtime_error("cannot create output temp");fs::path tmp=temp.data();try{size_t done=0;while(done<data.size()){ssize_t n=write(fd,data.data()+done,data.size()-done);if(n<0)throw std::runtime_error("cannot write output temp");done+=size_t(n);}if(fsync(fd)||close(fd)){fd=-1;throw std::runtime_error("cannot sync output temp");}fd=-1;if(link(tmp.c_str(),path.c_str()))throw std::runtime_error(errno==EEXIST?"target already exists":"cannot publish target");fs::remove(tmp);}catch(...){if(fd>=0)close(fd);fs::remove(tmp);throw;}}

int main(int argc,char**argv){
  try{
    if(argc<6)throw std::runtime_error("usage: converter source.ifc manifest.json geometry.glb --source-file-id ID [--max-input-bytes N]");
    fs::path source=argv[1],manifestPath=argv[2],glbPath=argv[3];std::string fileId;uintmax_t limit=512ull*1024*1024;Limits limits;
    for(int i=4;i<argc;i++){std::string a=argv[i];if(a=="--source-file-id"&&i+1<argc)fileId=argv[++i];else if(a=="--max-input-bytes"&&i+1<argc)limit=std::stoull(argv[++i]);else if(a=="--max-entities"&&i+1<argc)limits.entities=std::stoull(argv[++i]);else if(a=="--max-vertices"&&i+1<argc)limits.vertices=std::stoull(argv[++i]);else if(a=="--max-indices"&&i+1<argc)limits.indices=std::stoull(argv[++i]);else if(a=="--max-output-bytes"&&i+1<argc)limits.outputBytes=std::stoull(argv[++i]);else throw std::runtime_error("unknown or incomplete option: "+a);}
    if(fileId.empty())throw std::runtime_error("--source-file-id is required");
    if(normalized(source)==normalized(manifestPath)||normalized(source)==normalized(glbPath)||normalized(manifestPath)==normalized(glbPath))throw std::runtime_error("source and target paths must differ");
    auto size=fs::file_size(source);if(size>limit)throw std::runtime_error("input exceeds --max-input-bytes");
    std::ifstream in(source,std::ios::binary);if(!in)throw std::runtime_error("cannot open source");std::string raw((std::istreambuf_iterator<char>(in)),{});if(raw.size()!=size)throw std::runtime_error("source changed while reading");count_step_entities(raw,limits.entities);
    auto model=make_shared<BuildingModel>();ReaderSTEP reader;std::vector<std::string> errors;reader.setMessageCallBack([&](shared_ptr<StatusCallback::Message> m){if(m&&m->m_message_type>=StatusCallback::MESSAGE_TYPE_ERROR)errors.push_back(m->m_message_text);});std::istringstream stream(raw);reader.loadModelFromStream(stream,std::streampos(raw.size()),model);if(!errors.empty())throw std::runtime_error("IFC parse failed: "+errors.front());
    if(model->getMapIfcEntities().size()>limits.entities)throw std::runtime_error("entity count exceeds --max-entities");double factor=model->getUnitConverter()->getLengthInMeterFactor();if(!std::isfinite(factor)||factor<=0)throw std::runtime_error("invalid model length unit factor");auto elements=extract(model,factor,limits);if(elements.empty())throw std::runtime_error("no represented products");auto glb=make_glb(elements,size_t(limits.outputBytes));auto text=manifest(fileId,sha256(raw),sha256(glb),factor,elements);if(text.size()>limits.outputBytes)throw std::runtime_error("output exceeds --max-output-bytes");std::vector<uint8_t> manifestBytes(text.begin(),text.end());
    publish(glbPath,glb);try{publish(manifestPath,manifestBytes);}catch(...){fs::remove(glbPath);throw;}
    return 0;
  }catch(const std::exception&e){std::cerr<<e.what()<<'\n';return 1;}
}
